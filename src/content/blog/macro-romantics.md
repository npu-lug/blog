---
title: Syntax -> Syntax 的迷人与危险：我们为什么对宏又爱又恨？
pubDate: 2026-10-10
slug: macro-romantics
authors:
  - name: Yurin
    url: https://blog.yurin.top/
---

> *“Macro, light of my life, fire of my loins. My sin, my soul.”*[^lolita]

程序员遇到“重复”，通常会最先想到函数：把相同的计算逻辑放进函数体，把不同的数据变成参数。

直到有一天，我们遇到了一种无法被函数收敛的“重复”：每次都要建立相同的作用域，每次都要安排相同的求值顺序，每次都要根据一个类型的形状去硬编码另一段程序。此时，我们想交给函数的东西，开始越界了——**它不再只是数据，而是表达式、声明，以及这些语法结构之间的关系。**

## 求值太早了

假设我们理想中有一个这样的函数：

```c
unless(cond, do_something())
```
我们的诉求很简单：当条件不成立时，执行后面的操作。

但在严格求值（Strict Evaluation）的语言里，`do_something()` 会在 `unless` 被真正调用之前完成求值。函数体收到的是计算后的结果，它已经丧失了决定“这次执行应不应该发生”的权力。

当然，你可以反驳说，通过闭包的惰性求值就能解决这个问题：

```js
unless(cond, () => do_something())
```

这完全是有效的设计。高阶函数、惰性求值、资源管理接口，确实能承担许多看起来“必须用宏”的控制抽象。仅凭“需要延迟执行”这一点，还不足以证明一门语言必须开放语法变换的后门。[^evaluation]

但是，需求是贪婪的。比如，我们希望写一个 `trace(a + b)`，不仅能打印出 `a + b` 的值，还能打印出 `a + b` 这段**源码字面量**；我们希望一个绑定形式能自动为后续代码引入局部变量；我们希望根据一份类型声明，在编译期生成配套的序列化实现。

普通的函数调用只接收“值”，无法还原产生这个值的那段源码；一个返回 `3` 的闭包，也不会向调用者开放其内部的语法结构。

为了突破这一点，我们可以退而求其次——显式传入字符串或语法树：

```c
unless_eval_lisp(cond, "(do_something)")
```

当程序的结构变成了接口中的“数据”，似乎一切都迎刃而解。只要我们能找到一种映射（Projection），把 `do_something` 的结构从一种数据表示（如 Lisp 的 S-表达式）：

```scheme
(define do_something 
    (lambda () 
        (set! counter
            (+ counter 1))))
```
转化为另一种可执行的形式：

```c
void do_something() {
    counter += 1;
}
```

这就揭示了一个残酷的真相：**创造一门“第二语言”并不是必要的，前提是，这门语言必须允许将程序本身投影成一种可被程序操作的数据。**

## 文本替换：游走在边界外的幽灵

最直接的办法，是在编译器真正“理解”程序之前，先暴刀修改程序的写法。

C 语言的预处理器经常被称为“文本替换”。更准确地说，宏替换处理的是预处理 Token；此时代码已经经过了词法切分，但还没有承担起 C 语言完整的语法树构建、类型推导和词法绑定。[^cpp-tokens]

比如这样：

```c
#define UNLESS(cond, body) if (!(cond)) body
```

坏消息是，因为宏替换发生在编译器建立语法心智之前，**宏的参数不受类型检查的保护，也没有词法绑定的概念**。
`UNLESS(1, printf("hello"))` 会被乖乖展开成 `if (!(1)) printf("hello")`；而 `UNLESS(1, int x = 3)` 会被展开成 `if (!(1)) int x = 3`，这在 C 语言中是非法的。

又比如经典的“优先级灾难”：

```c
#define TWICE(x) x + x
```

当你写下 `TWICE(5 ^ 1)` 时，它会被无情地展开成 `5 ^ 1 + 5 ^ 1`。
如果你使用 `clang -Xclang -ast-dump`，你会看到它的 AST 是这样的：

```text
  `-CompoundStmt 0x55af9e31adc0 <col:14, line:5:1>
    `-BinaryOperator 0x55af9e31ada0 <line:4:11, col:15> 'int' '^'
      |-BinaryOperator 0x55af9e31ad60 <col:11, col:11> 'int' '^'
      | |-IntegerLiteral 0x55af9e31ace0 <col:11> 'int' 5
      | `-BinaryOperator 0x55af9e31ad40 <col:15, col:11> 'int' '+'
      |   |-IntegerLiteral 0x55af9e31ad00 <col:15> 'int' 1
      |   `-IntegerLiteral 0x55af9e31ad20 <col:11> 'int' 5
      `-IntegerLiteral 0x55af9e31ad80 <col:15> 'int' 1
```

即 `(^ (^ 5 (+ 1 5)) 1)`，而根本不是你想要的 `(+ (^ 5 1) (^ 5 1))`。[^cpp-precedence]

> *“多加几个括号不得了 😅”*

但加括号并不能拯救所有的灾难，比如副作用溢出：

```c
TWICE(read_sensor())
```

它会被展开成 `read_sensor() + read_sensor()`。如果 `read_sensor()` 会触发真实的硬件操作，那么你将得到两次副作用，而不是一次。[^cpp-side-effects]

我们之所以对这里的行为感到不安，是因为 **`TWICE(...)` 虚伪地借用了函数调用的外观，却拒绝履行普通函数“参数先求值”的契约。**

文本替换允许我们定义一个极小的语言扩展，却把这个扩展应当遵守的规则全部推给了使用者。某个参数允许包含逗号吗？展开结果算表达式还是语句？临时变量会不会遮蔽调用者的名字？这些原本由编译器统一回答的“语言标准”，退化成了每个宏自己的“README 说明”。

这也解释了为什么预处理器至今难以被彻底抛弃：**它因为不理解程序的许多边界，从而拥有了跨越所有边界的特权。** 我们一面贪婪地依赖这种自由，一面试图用无尽的括号、命名约定（比如 `do { ... } while(0)`）和死板的开发纪律，去补救那些没有被接口表达的承诺。[^cpp-statement]

## 读入程序，改写程序

更好的思路是：先让编译器把程序读成有结构的“树”，然后再去改写这棵树。在这个阶段，虽然尚未进行类型检查和名字解析，但至少程序的层级和边界是明确的。我们把程序的结构传给一个宏函数，让它返回一个新的结构。

在 <del>CLannad</del> Common Lisp 中，你可以优雅地写出这样一个宏：

```lisp
(defmacro unless* (condition &body forms)
  `(if ,condition
       nil
       (progn ,@forms)))
```

初看这段代码，你可能会觉得它和 C 的 `#define` 换汤不换药——无非是把 `#define` 换成了 `defmacro`，把文本拼接换成了反引号（`` ` ``）和逗号（`,`）。

但这正是 Lisp 施展 **“同像性（Homoiconicity）”** 魔法的时刻。

这里的反引号被称为**准引用（Quasiquote）**，逗号被称为**反引用（Unquote）**，而 `,@` 是**拼接反引用（Unquote-splicing）**。它们看起来像字符串模板插值，但操作的却是列表、符号等正儿八经的 Lisp 内存对象。我们用这些数据对象来表示程序的形式，而不必把它们降维成字符串再去重新“猜测”表达式的边界。[^quasiquote]

当展开器遇到 `(unless* (= 1 2) (print "yes") (print "ok"))` 时，宏的 `condition` 参数接收到的是真实的列表结构 `(= 1 2)`，而不是运算结果。宏在编译的展开阶段运行，利用拼装逻辑构造出一棵以 `if` 开头的新树，再交还给编译器。

如果只看这一层的输入输出，它的函数签名非常纯粹：`Syntax -> Syntax`。[^lisp-expansion]

因为操作的是树而不是扁平文本，我们在 C 语言里遇到的“优先级灾难”瞬间烟消云散。`(+ (^ 5 1) (^ 5 1))` 的边界绝对清晰，绝不会在展开后发生运算顺序的越界。

那么前文提到的“副作用与重复求值”呢？在 Lisp 中，既然宏本身是一段真正的代码，我们可以轻易地引入局部变量来缓存求值结果。比如那个会导致 `read_sensor()` 执行两次的 `TWICE`，可以这样写：

```lisp
(defmacro twice-safe (expr)
  `(let ((temp ,expr))
     (+ temp temp)))
```

你看，展开后：
```lisp
(let ((temp (read-sensor)))
  (+ temp temp))
```
完美！`read-sensor` 只会被求值一次，结果存入 `temp`，然后再相加。我们似乎找到了宏的终极形态：它既享有改变语法的特权，又具备普通函数的安全感。

**那么，古尔丹，代价是什么呢？**

上面的 `twice-safe` 恰好避开了一个致命雷区：`let` 的初始化式是在新绑定之外求值的，传进来的 `expr` 不会被宏内部的 `temp` 遮蔽。但如果宏需要把调用者的代码强行拉入新绑定的作用域，灾难就降临了。[^let-scope]

假设我们写一个只对第一个参数求值一次的 `or*`：

```lisp
(defmacro or* (first second)
  `(let ((temp ,first))
     (if temp temp ,second)))
```
然后在外部使用它：
```lisp
(let ((temp 42))
  (or* nil temp))
```
预期中，当第一个参数为 `nil` 时，应返回第二个参数的值（42）。但展开后却变成了：

```lisp
(let ((temp 42))
  (let ((temp nil)) ;; 宏内部产生的变量遮蔽了外部的 temp
    (if temp temp temp)))
```
最后那个本应指向外部 `42` 的 `temp`，无辜地落入了宏自动生成的 `let ((temp nil))` 的魔爪，结果返回了 `nil`。哪怕你集齐了所有的光玉，最后也一定会被虐得痛哭流涕，在宏的使用说明里被迫加一条耻辱的规定：“*警告：请勿在宏的作用域内使用名为 `temp` 的变量*”。

这就是大名鼎鼎的**变量捕获（Variable Capture）**。展开过程并未改变变量的拼写，却悄然篡改了它所指向的词法绑定。

## 卫生宏：给 AST 做上下文染色

最直接的防范手段，是给宏产生的临时变量换一个“独一无二”的名字。

Common Lisp 提供了 `gensym`，用于在编译期生成系统内唯一的未驻留符号（Uninterned Symbol）：[^gensym]

```lisp
(defmacro or* (first second)
  (let ((temp (gensym "TEMP")))
    `(let ((,temp ,first))
       (if ,temp ,temp ,second))))
```
展开后，宏内部的名字会变成类似 `#:TEMP-1234` 的符号，彻底杜绝了与调用处 `temp` 碰撞的可能。但这依然是一项“防君子不防小人”的机制，极度依赖宏作者的自觉与审慎。*(当然，Lisp 哲学的一大基石就是假定程序员足够清醒)*

Scheme 的 `syntax-rules` 则向前迈出了史诗级的一步：它将这项防碰撞的责任直接从程序员手中剥离，交给了展开系统，从而确立了现代编程语言中的**卫生宏（Hygienic Macros）**标准。[^hygiene]

```scheme
(define-syntax or*
  (syntax-rules ()
    ((_ first second)
     (let ((temp first))
       (if temp temp second)))))
```

卫生性在这里提供了极为严密的**双向词法保护**。

**第一向：保护调用者的环境**
```scheme
(let ((temp 42))
  (or* #f temp)) ;; => 42
```
调用者传进来的 `temp` 绝不会被宏模板内部的 `let ((temp ...))` 吞噬，展开系统会在底层将这两个同名标识符剥离开来。

**第二向：保护宏作者的环境**
```scheme
(let ((if (lambda args 'intercepted)))
  (or* #f 42)) ;; => 42
```
哪怕调用者丧心病狂地在局部把 `if` 关键字重新绑定成了一个普通的函数，宏模板里的 `if` 依然死死锚定在定义时的原生条件语法上，绝不被外部环境截胡。

展开系统不再将代码视作扁平的结构，而是为每一个标识符附加上了**展开上下文（Syntax Context）**。两个名字是否“相同”，不再仅取决于它们拼写如何，更取决于它们“诞生于何处、从属于哪个词法作用域”。[^scope-sets]

### What Color is Your Context?[^function-color]

卫生宏理论的建立，无疑是元编程领域的一座丰碑。然而，在真实的工程实践中，这也带来了新的权衡——**上下文的割裂**。

宏的内部上下文与外部调用者的上下文被高墙阻隔。在正常运转时，它安全得令人感动；但当展开后的代码触发类型错误或验证失败，编译器防线被击穿时，它就会把底层修饰过的、面目全非的内部名字直接糊在开发者脸上：[^macro-diagnostics]

```text
error: type mismatch in variable #<syntax temp_73_0x8f3a>
```

这下轮到开发者过 **SC (Sanity Check)** 检定了。这种因为重命名机制导致的认知负荷，—— 就像 C++ 的 Name Mangling、C++ 的 Template Instantiation 报错、C++ 的 Lambda Type Tag 一样、C++ 的 auto lambda 一样。为了换取系统底层机制的一致性，程序员在 Debug 时必须做出“小小的牺牲”。
> *🎵看成败人生豪迈，只不过是从头再来🎵*

## 隐式的约定：谁在驱动 `-> Syntax`？

当我们用纯函数的视角将宏概括为 `Syntax -> Syntax` 时，我们其实做了一个过于理想化的抽象。

借用逻辑学家 Tarski 对 **对象语言（Object Language）** 与 **元语言（Metalanguage）** 的划分：对象语言是被我们谈论、操作的代码；元语言则是编译器运行的、用来操纵对象语言的语言。[^tarski]

在 `Syntax -> Syntax` 的假定中，宏看似是一个生活在元语言世界里的纯函数：吃进一棵树，吐出一棵树。但在编译流程中，一棵孤立的数据树毫无意义：

```scheme
(define code '(+ 1 2))
code ;; => (+ 1 2)，这只是一份躺在内存里的普通数据
```

这棵树本身并不知道自己应当何时被求值、该如何拼回 AST 骨架、以及如何融入当前的词法环境。要让这段数据重新从“被谈论的数据”变回“可执行的代码”，背后必须依赖编译器提供的一整套**展开协议（Expansion Protocol）**。

在传统的宏设计中，编译器始终在幕后扮演着一个拥有特权、不可见的，<del>蜥蜴人的、deep state 的、货币战争的、罗斯柴尔德家族的</del>黑箱。

它隐式地拦截宏的调用点，收缴宏返回的语法树，将其缝合回主干，并递归地调度下一个求值阶段。

> 你甚至不愿意叫他一声教父

## 效应：让语言与编译器达成显式协议

在现代 UI 框架的演进史上，发生过一段极其相似的认知转变。

React 的经典心智模型倾向于 `UI = f(State)`：组件只是一个纯函数，返回元素树（Virtual DOM）的描述。从函数的角度看，它非常干净；但由于数据树本身无法直接渲染到屏幕上，React 必须在幕后维护一个庞大且隐式的 Reconciler，用来追踪副作用、对比差异并更新 DOM。[^react]

而在 Jetpack Compose（或类 SolidJS 范式）中，构建界面的函数签名演变成了 `@Composable (State) -> Unit`。
它不再以“返回一棵完整的树”为终极目标，而是**将“向环境提交 UI 结构”建模成一种伴随函数执行的“环境要求”或“效应（Effect）”**。[^compose]

如果我们将这个视角带回元编程，我们或许可以重新审视宏的函数签名：

**宏为什么非得是一个必须返回 `Syntax` 的函数？为什么不能把“展开代码”直接建模成一种代数效应？**

在拥有效应系统（Algebraic Effects）的语言视角下，宏的展开可以被更自然地定义为：[^effects]

```text
-> Unit !Macro
```

这一微小却深刻的转变意味着：**Effect 变成了对象语言（代码自身）与编译器（作为元语言宿主）之间的显式交互协议。**

这样带来的工程与架构红利是巨大的：
1. **编译器去神圣化**：编译器不再是一台在幕后默默做树替换的神秘机器，它在本质上降维成了一个标准的 **Effect Handler**。
2. **宏的能力泛化**：宏不再是一个只能被动把生成结果打包抛回的函数。在执行过程中，它可以通过 `!Macro` 效应向身处的编译器上下文发起实时请求——它可以随时 `emit` 新的语法片段、按需注入全局声明、查询当前模块环境，甚至直接向 IDE 提交带有精准行列号的编译期诊断（Diagnostic）。[^macro-protocol]

## 准引用：作为一种受控的控制流中断

沿着这个协议化的思路继续推演，许多原本需要编译器深度特化的 Hack 机制，都能在效应系统里找到更统一的数学抽象。

例如 Lisp 家族中极为强大的准引用（`` ` ``）与反引用（`,`）。在传统的 Lisp 展开器实现中，编译器往往需要内置一个专门的模板解析状态机，去费力地维护嵌套反引用的深度计数（Depth Counter）。

但如果从效应的视角审视，“把一段表达式动态插入模板”本质上是什么？它只是在遍历 AST 并将其提升（Lifting）为语法对象的过程中，产生了一个**请求暂停并接入外部上下文的控制流中断**

```text
effect Quote =
  | splice : Syntax -> Syntax
```

当遍历逻辑深入模板内部、遇到需要被反引用的节点时，它根本不需要了解任何外层编译器的特权逻辑。它只需要简单地触发一个 `splice` 效应（抛出当前的 Syntax）。外层的 Compiler Handler 捕获到这个请求，将目标表达式计算并接入后，恢复（Resume）原本的遍历执行。[^quote-effects]

## 结语

无论我们用多么现代的理论去招安宏，只要它还存在一天，这场故事里就永远盘踞着一道无法消解的张力：**Soundness（健全性）与 Expressiveness（表现力）的终极对立。**

这也是我们对宏又爱又恨的根本原因。如果你的宏系统设计得极其 Sound——类型绝对安全、上下文严格隔离、边界无懈可击，那么它的表现力往往会跌入谷底，沦为一个稍微高级点的模板库。它无法帮你凭空生成新的绑定，无法逾越词法屏障，自然也无法构建出那些能重塑语言形态的领域特定语言（DSL）。[^soundness]

## 宏不跟我走，我就组织 codegen 去

既然在语言内部做语法变换那么痛苦，我们当然可以选择直接掀桌子直接去做 Codegen（代码生成）。

Protobuf、gRPC、OpenAPI、各种繁复的 ORM 骨架。当语言内部的元编程走到死胡同，大能们直接祭出了 **“带外（Out-of-band）元编程”** 的降维打击。

Codegen 根本不跟你讲什么 AST、展开上下文或是卫生性。它运行在编译器苏醒之前，跳出了目标语言的一切法则。在一段用来生成 Rust 的 Python 脚本眼里，那高贵的、拥有所有权系统的 Rust 代码，只不过是一堆待拼接的、扁平的字符串。[^codegen]

这是一种极致的实用主义，**我们花了整整半个世纪，好不容易把宏从 C 语言的“文本替换”进化成了高贵的“代数效应”；结果在庞大的工程现实面前，大家又转身投入了“文本拼接”的怀抱**——只不过这一次，我们拼接的不再是单个表达式，而是成百上千个源文件。

## 元编程补完计划

但如果你“既要又要”呢？如果你试图构建一个既绝对 Sound（健全且可证明），又完全 Complete（图灵完备、能对任意 AST 进行任意深度的重写与类型推导）的宏系统？[^completeness]

那么恭喜你，你的编译器类型系统将变得无穷复杂，甚至滑入不可判定（Undecidable）的深渊。为了让展开器确认你的宏不会破坏整个类型宇宙，你可能不得不在依赖类型（Dependent Types）里战战兢兢地证明代码的等价性，最后**要在神谕（Oracle）上去写你的业务代码了。**[^undecidability]

---

[^lolita]: 仿写 Vladimir Nabokov 的小说 *Lolita*（1955）开篇，将主人公呼唤的名字换成了 Macro。可参见[出版社页面](https://www.penguinrandomhouse.co.uk/books/182076/lolita-by-nabokov-vladimir/9780241951644)收录的开篇引文。

[^evaluation]: 以 JavaScript 为例，实参表达式会在调用函数之前求值，见 ECMAScript 的 [ArgumentListEvaluation](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-argument-lists-runtime-semantics-argumentlistevaluation)。传入 `() => do_something()` 时，先求值得到的是函数对象；稍后调用它才执行函数体。这是用 thunk 显式延迟计算，并不意味着语言本身改用了惰性求值。

[^cpp-tokens]: 见 GCC 预处理器文档的 [Tokenization](https://gcc.gnu.org/onlinedocs/cpp/Tokenization.html)。这里“宏的参数不受类型检查”指宏替换阶段不检查类型；展开后的 C 程序仍须接受编译器的语法和类型检查。

[^cpp-precedence]: GCC 的 [Operator Precedence Problems](https://gcc.gnu.org/onlinedocs/cpp/Operator-Precedence-Problems.html)说明了为什么参数和整个展开结果都需要括号。正文中的前缀表达式是 AST 示意，其中 `^` 表示 C 的按位异或，不是 Common Lisp 的标准运算符；Common Lisp 中对应的函数是 `logxor`。

[^cpp-side-effects]: 见 GCC 的 [Duplication of Side Effects](https://gcc.gnu.org/onlinedocs/cpp/Duplication-of-Side-Effects.html)：括号可以保护分组，却不能让复制到多个位置的实参只求值一次。该节也展示了用 GNU C 的语句表达式和局部变量缓存实参的办法。

[^cpp-statement]: `do { ... } while (0)` 是语句包装惯用法，不是命名约定：它让多条语句的宏连同调用者写下的分号表现为一条语句，便于放进 `if/else` 等结构。见 GCC 的 [Swallowing the Semicolon](https://gcc.gnu.org/onlinedocs/cpp/Swallowing-the-Semicolon.html)。它本身不提供卫生性或单次求值保证。

[^quasiquote]: Common Lisp HyperSpec 的 [§2.4.6 Backquote](https://www.lispworks.com/documentation/HyperSpec/Body/02_df.htm)规定了反引号、逗号与 `,@` 的数据构造语义。准引用也能用于普通数据构造，并非宏专用；同像性在这里指程序形式可由语言自身的数据结构表示，不意味着语法、数据与执行语义毫无区别。

[^lisp-expansion]: 见 Common Lisp HyperSpec 的 [DEFMACRO](https://www.lispworks.com/documentation/HyperSpec/Body/m_defmac.htm)：宏参数绑定到调用形式的结构片段，展开函数实际接收 form 和 environment，再返回 form。因此 `Syntax -> Syntax` 是省略环境与效应后的概括，不能据此断言宏是纯函数；宏展开也不限于文件编译阶段。

[^let-scope]: Common Lisp HyperSpec 的 [LET、LET*](https://www.lispworks.com/documentation/HyperSpec/Body/s_let_l.htm)明确规定，`let` 的新绑定作用域不包含初始化式。正文的 `twice-safe` 因而避开了这里的 `temp` 捕获，但这只说明该例的绑定安排安全，不构成一般的卫生性保证。

[^gensym]: 见 Common Lisp HyperSpec 的 [GENSYM](https://www.lispworks.com/documentation/HyperSpec/Body/f_gensym.htm)。`gensym` 是普通函数，也能在运行期调用；在宏体中使用时，它随展开执行。唯一性来自每次返回一个新的符号对象，而非保证打印名称永不重复；两个都打印为 `#:G100` 的新符号仍可不是同一个符号。

[^hygiene]: 卫生宏的经典起点是 Kohlbecker、Friedman、Felleisen 与 Duba 的 [Hygienic macro expansion](https://doi.org/10.1145/319838.319859)（1986）。正文的两向保护对应 Scheme 报告中的卫生性与引用透明性规则，见 [R6RS §9.2 Macros](https://r6rs.org/final/html/r6rs/r6rs-Z-H-12.html)；该节也说明变量与语法关键字共享名称空间，因此局部绑定可以遮蔽 `if`。

[^scope-sets]: 一种具体的上下文模型见 Matthew Flatt 的 [Binding as Sets of Scopes](https://users.cs.utah.edu/plt/scope-sets/)（POPL 2016）：用标识符携带的作用域集合决定绑定。它不是所有卫生宏实现的统一算法；展开与绑定解析也可能相互穿插，不能普遍理解成“先完整改树，再统一解析名字”。

[^function-color]: 标题借用了 Bob Nystrom 的 [What Color is Your Function?](https://journal.stuffwithstuff.com/2015/02/01/what-color-is-your-function/)（2015）。原文用函数“颜色”比喻同步与异步调用之间的限制；这里把这个意象移用于宏的词法上下文。

[^macro-diagnostics]: 下方报错是示意，不是某个编译器的实际输出。卫生性不要求工具向用户暴露重命名后的内部名称；例如 Racket 的 [Macro Debugger](https://docs.racket-lang.org/macro-debugger/index.html)可逐步展示展开，并呈现词法绑定与源码位置。诊断是否难读，还取决于源码信息的保留和工具设计。

[^tarski]: 见 Alfred Tarski 的 [The Semantic Conception of Truth and the Foundations of Semantics](https://www.jfsowa.com/logic/tarski.htm)（1944），第 9 节。对象语言与元语言是相对角色，可以使用同一种语言；正文把宏和编译器代入这一区分，是元编程语境下的借用，不是 Tarski 对编译器架构的主张。

[^react]: React 官方的 [Render and Commit](https://react.dev/learn/render-and-commit)区分了调用组件计算界面的 render 阶段，以及实际更新 DOM 的 commit 阶段。`UI = f(State)` 是心智模型；组件还可以接收 props、读取 context，副作用也有独立的执行时机。

[^compose]: Compose 的 [Thinking in Compose](https://developer.android.com/develop/ui/compose/mental-model)说明，发出 UI 的 composable 无须返回 UI 对象。但 `@Composable` 不等于代数效应，Compose 仍有运行时维护的 UI 结构，且要求组合函数避免任意副作用。Solid 的相似点主要是[细粒度响应式更新](https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity)，不能直接套用 Compose 的 `State -> Unit` 签名。

[^effects]: 代数效应与处理器的入门可见 Matija Pretnar 的 [An Introduction to Algebraic Effects and Handlers](https://www.eff-lang.org/handlers-tutorial.pdf)（2015），尤其是第 2 节的操作、处理器与恢复续延。正文的 `-> Unit !Macro` 是效应标注的示意写法；用它重构宏展开是本文提出的设计方向，引用文献并未给出这一宏系统。

[^macro-protocol]: 返回语法与向展开环境发出请求可以共存。Racket 的 [Syntax Transformers](https://docs.racket-lang.org/reference/stxtrans.html)已提供 `local-expand`、`syntax-local-lift-expression` 和 `syntax-local-lift-module` 等接口；提出显式效应协议，是重新组织这些交互的思路，并不意味着传统宏一概缺少它们。仅改函数签名，也不会自动解决阶段、绑定与诊断问题。

[^quote-effects]: 这里是准引用实现的设计草图。效应处理器可以承载暂停与恢复，却仍须规定反引用在哪一层模板生效、在哪个环境和阶段求值，以及结果如何保留词法上下文；这些语义不能由 `splice : Syntax -> Syntax` 单独决定。嵌套规则可对照前引的 [HyperSpec Backquote](https://www.lispworks.com/documentation/HyperSpec/Body/02_df.htm)；普通反引用与列表拼接反引用也需区别处理。

[^soundness]: 这里的“对立”是工程权衡的修辞，不是卫生性或类型健全性必然排斥 DSL 的定理。[Racket 宏指南](https://docs.racket-lang.org/guide/macros.html)介绍了用宏扩展语言；[R6RS 的 `datum->syntax`](https://r6rs.org/final/html/r6rs-lib/r6rs-lib-Z-H-13.html)允许受控引入调用处可见的绑定；[MetaOCaml](https://okmij.org/ftp/ML/MetaOCaml.html)则展示了带类型保证的代码生成。卫生性、类型健全性与生成新绑定是不同维度。

[^codegen]: 工程实例可见 Protobuf 的[代码生成说明](https://protobuf.dev/programming-guides/editions/#generated)、gRPC 的[服务与客户端生成流程](https://grpc.io/docs/what-is-grpc/introduction/)及 OpenAPI Generator 的[生成器列表](https://openapi-generator.tech/docs/generators/)。带外生成并不必然采用字符串拼接，也可以操作 AST 或其他中间表示；生成出的源码仍需满足目标语言的编译规则。“宏进化成代数效应”是本文叙事，并非这些工具共同经历的历史。

[^completeness]: “完备性”（completeness）与“图灵完备性”（Turing completeness）不是同一个概念。图灵完备指计算表达能力；若讨论静态分析器，完备性通常要相对于待判定的性质定义，例如是否能接受所有满足该性质的程序。这里应将“能写任意计算”和“能自动验证任意计算”分开理解。

[^undecidability]: 对任意图灵完备的宏，自动且总能结束地判定其是否终止，会遇到停机问题；经典背景见 Turing 的 [On Computable Numbers, with an Application to the Entscheidungsproblem](https://www.cs.virginia.edu/~robins/Turing_Paper_1936.pdf)（1936–1937）。这不推出“图灵完备的宏使类型检查必然不可判定”：可以先运行宏，再检查展开结果。类型安全也不等于语义等价；要求证明某次变换正确、检查给定证明，与自动发现任意变换的正确性证明，是不同任务。
