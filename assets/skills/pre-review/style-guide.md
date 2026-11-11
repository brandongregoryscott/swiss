# Brandon's review style guide

Distilled from about six months of Brandon's own PR review comments. The examples are
paraphrased in his voice with project-specific names swapped for generic ones; the phrasing,
the questions he asks and what he chooses to flag are the calibration.

His review substance concentrates in React/TypeScript frontends and their shared types. On
small or mostly AI-authored PRs he often approves without comment, so a finding has to be worth
raising, not just technically true.

Two things he cares about rarely show up as review comments because he fixes them directly or
codifies them in CLAUDE.md: spacing around dense logic, and single-letter variable names. They
fold into **Naming** and **Control flow & structure** below rather than standing as their own
categories.

---

## 1. DRY: reuse an existing helper/type/util instead of duplicating

By far the most common comment type. He calls out duplicated logic, duplicated types, and
duplicated string constants, almost always by naming the specific existing thing that should be
reused instead.

> "This type (representing a range that can be an object or tuple) is repeated a lot. Why don't
> we add a type for it instead of duplicating it? Even better, we can extract separate types for
> the object vs. tuple structure, and add separate type guards."

> "We have similar logic for constructing this value -> option lookup map over in the other
> filter component. Maybe that's worth putting in its own utility function and reusing both
> places?"

> "This type looks a lot like the generated filters type from the GraphQL schema. Why do we need
> to define it again?"

> "Same comments in this file about reusing the same types + utilities from a common module if
> possible." (repeated near-verbatim across a set of sibling table-cell components)

> "Ahhh, yeah, we should probably fix that so we don't have 3 copies of this icon logic 😓"

> "We're trying to reduce the number of places we hard-code paths, since that has bitten us in
> the past (linking out to routes that no longer exist, etc), and centralizing the routes in one
> place helps for discoverability. ... Let's try to avoid recreating the same debt that the
> current nav components have :)"

## 2. Extract when something has grown too big

He asks for extraction at three grains: pulling a function-that-returns-JSX out as a real
component, splitting a file once its exported pieces multiply, and moving code to the module
that already owns the concept.

> "Let's just make this a utility component, not a utility function that returns JSX."
>
> ```suggestion
> function CustomDescription({ showActions }: { showActions: boolean }) {
> ```

> "This feels like a component, not a utility function." (re: a formatter with a `try`/`catch`
> that returns JSX)

> "Let's split any of these components that actually need to be exported into their own files
> that are named accordingly... This will help with discoverability when fuzzy searching file
> names. If these components aren't reused outside of this component, they don't need to be
> exported/extracted."

> "Can this be extracted to its own file?"

> "Can we move these components to the feature's `components` folder along with the tab that
> uses them? We can also export the helper from a `utils.ts` file there if we need it to be
> exported."

## 3. Naming clarity

Covers ambiguous names, inconsistent terminology for the same concept, and casing conventions.
The concern is always "would the name alone tell someone what this is/does," not style for its
own sake.

> "This key is confusing, since `multi-select` is also a `type` for the config. Can we figure
> out a different name for this so we don't have `config.type === 'multi-select' &&
!config.multiSelect` checks? 😂"

> "What does this function do that `convertListToString` doesn't? The naming of this function
> does not make the distinction obvious."

> "Any reason to switch terminology from `sanitize` to `clean`? 😛"
>
> ```suggestion
> const sanitizedValue = sanitizeTextValue(value);
> ```

> "Generally event handlers are named as `onEvent` when defined as props, and `handleEvent` when
> implemented."

> "Minor: I think we generally SCREAMING_SNAKE_CASE constants in the top-level scope."

> "Is this prefixed with `_` because we aren't using it? Are we supposed to be using it for
> something?"

## 4. React state vs. derived state

State and effects doing work that a plain computed value, a library's own return value, or a
hoisted constant would do for free.

> "Yeah, we definitely don't need to be doing all this manual async work in an effect. The
> generated query hooks take care of all of this."

> "We can probably just read the token from the `data` object in the mutation result, instead of
> tracking an additional state for it."
>
> ```ts
> const [createToken, { data }] = useCreateTokenMutation({});
> const token = data?.createToken.token ?? "";
> ```

> "Do `useCallback` (and the `useMemo` for the tab index) actually get us anything? These don't
> seem like particularly expensive computations, and we aren't passing these functions as props
> to any components that might break memoization... I would drop these unless there's a good
> reason to keep them in."

> "Do these columns need to be initialized on every render? I would pull them into a constant
> outside of the scope of the component."

> "I think we can probably use `react-hook-form` to manage all of this form state instead of raw
> `useState`... almost all of the other forms are wired up this way already."

> "Let's use the callback variant for the state setter if we're relying on a previous state:"
>
> ```suggestion
> onClick={() => setCollapsed((collapsed) => !collapsed)}
> ```

## 5. Comment quality

He's against unnecessary comments by default. In review this surfaces as calling out
AI-generated comments that restate the code, "section divider" comments, and comments that
would be more useful as JSDoc.

> "Does this comment have any meaning, or is it leftover from AI?"

> "I am assuming Claude added most of these 'context' comments, but if they feel necessary in a
> specific file, it probably means it needs to be broken out. I would just remove these.
> `function UserMenu()` describes itself well enough."

> "These comments would be more useful as JSDocs, so they show up on hover in your editor."

> "FWIW, comments that describe 'blocks' don't really need to be JSDoc comments. These won't get
> attached to anything in the IDE AFAIK... These 'region' comments don't add a lot of value
> as-is, since they blend in and don't attach to anything."

> "Nitpick: this comment serves no purpose 😛"

## 6. Control flow & structure

Reducing nesting via early returns, and cutting React fragments/ternaries that add indirection
without adding meaning.

> "We can reduce nesting here by short-circuiting if `isOpen` is false, since that's the only
> block."

> "This is a rather large block, can we short-circuit to reduce nesting here?"

> "You can probably remove these mutable variables and `for const of` loops with `Array.some`."

> "Does this fragment get us anything?" (recurs often; also: "Let's not return an empty fragment
> here, this should probably just be `if (!currentUser) { return null; }`")

> "Let's update this ternary to just be a conditional render as well, since this adds
> indirection for no reason."

## 7. Type safety & API design

Loose types (`any`, un-narrowed `object`), positional boolean parameters that are easy to
transpose, and reinventing what an enum or a composed type would express more safely.

> "Can we use `unknown` here instead of `any`?"

> "I'd refactor to be a type union or pseudo-enum." (re: two booleans that read as mutually
> exclusive but aren't typed that way), later formalized as: "I would refactor this to take an
> object with keys named `isRemoved: boolean, isChanged: boolean, and isAdded?: boolean` so
> consumers of this function are less likely to mix up the order of these three booleans."

> "This can probably be a 'constant object'/pseudo-enum:"
>
> ```suggestion
> const ExpirationChoice = { Default: 'default', ... } as const;
> type ExpirationChoice = ObjectValues<typeof ExpirationChoice>;
> ```

> "FWIW, if we are trying to just get every value from an enum as an array, you can just do
> `Object.values(SomeEnum)`. This would future-proof this implementation."

> "Can we make these enums with computed type unions instead?"

> "Let's remove this explicit `React.ReactElement` type, it gives us nothing." (and later: "Nit:
> Still seeing an explicit `React.ReactElement` type here that adds no value. I'd go thru and
> prune any of these in the new files added in this PR.")

## 8. Test structure & testability

Lower volume, but consistent: keep testable logic out of components, don't let two test files
quietly duplicate the same setup, and don't chase coverage that's already there at a lower
level.

> "Is there any reason to pull this logic out and stuff it in the component? ... we know 100%
> that code won't be tested if it lives inside the component, and I don't necessarily see a good
> reason to move it there instead of keeping it separated and tested."

> "Unless there's a compelling reason, I would keep those filter conversion methods in the
> domain class instead of inside of the component. The transformation logic, while necessary to
> get it into a state to send to the API, clutters up the component and we're losing the ability
> to easily test it in isolation."

> "It seems we're importing the same component as the other test file but we're aliasing it
> differently? (It also re-tests the same enabled/disabled behavior?) Can we consolidate these
> test suites?"

> "IMO, I'd prefer this setup in that test explicitly. We can keep this as the 'default' but I
> would probably set it in the test arrangement as well, so someone flipping the default doesn't
> have to figure out why that test is now failing and where the arrangement comes from."

---

## Checklist for an agent doing a review pass in Brandon's style

Read this whole document before starting, not just this section. The categories above are what
"matches his style" actually means, and the quotes are the calibration.

For each changed file in the diff, check for:

1. **DRY.** Does this duplicate a type, a utility function, a formatter, a string constant, or a
   lookup map that already exists elsewhere in the repo? If you can point at the specific
   existing thing, name it in the finding. A vague "this might be duplicated" is not useful; his
   own comments always name the existing type/util/file. Weight this toward duplication the PR
   is _introducing_: if the same shape already exists untouched elsewhere before this PR (an
   established local convention), that's a much weaker finding than a new duplicate this diff
   creates. Say so explicitly rather than treating every technical duplicate as equally worth
   raising.
2. **Extraction.** Is there a function that returns JSX and should be a component instead? A
   file whose exports have multiplied to the point it should split? Code sitting in a component
   or a generic folder that actually belongs to a specific domain module?
3. **Naming.** Would the name alone tell someone what this is, without reading the
   implementation? Flag ambiguous names, two names for the same concept in the same file, and
   deviations from established local convention (`onEvent` props vs `handleEvent` impls,
   `SCREAMING_SNAKE_CASE` for top-level constants).
4. **React state vs. derived state.** Is a `useState`/`useEffect` pair computing something that
   a plain expression, `useMemo`, or the return value of the library already in use (a
   query/mutation hook, a form library) would give for free? Is a constant being recreated every
   render for no reason? Is a `useCallback`/`useMemo` present with no memoization consumer to
   justify it?
5. **Comment quality.** Flag comments that look AI-generated and restate the code, "section
   divider" comments, and non-JSDoc comments describing a type/function that would be more
   useful as JSDoc. Hold this one to a high bar: a comment that states a genuine non-obvious
   _why_ (the reason a value was chosen, a constraint that isn't visible in the code) is a
   different thing from the restates-the-code comments his quotes target. When in doubt whether
   a comment explains a real "why" or dresses up a "what," don't flag it.
6. **Control flow & structure.** Nesting that a short-circuit/early return would flatten. Empty
   or unnecessary `<>...</>` fragments. Ternaries used as a conditional-render substitute where a
   plain `&&` would read better.
7. **Type safety & API design.** `any` where `unknown` or a generic would do. Positional boolean
   parameters that are easy to transpose (suggest an options object or discriminated union
   instead). Reinventing a type that could be composed from an existing generated/shared one.
   Explicit types that add no information (`React.ReactElement` return types, redundant type
   assertions).
8. **Test structure & testability.** Logic moved into a component in a way that loses unit-test
   coverage. Two test files duplicating the same setup/fixture. Component-level tests
   re-covering something already unit-tested at a lower level.

Then:

- Group findings by category, cite `path:line`, and quote the relevant code.
- For each finding, phrase it the way the examples above are phrased: name the specific
  duplicate/existing thing, ask the question rather than just asserting a rule ("does this
  fragment get us anything?" rather than "remove unnecessary fragment"), and keep it brief.
- Where the fix is a small, mechanical change, propose it as a ` ```suggestion ` block the way
  the examples do.
- **Don't** flag correctness, security, or logic bugs. That's a different review.
- **Don't** compute or mention a risk score, and **don't** post or edit anything on GitHub. This
  is a local, read-only pass.
- If a file or diff genuinely has nothing to flag against these eight categories, say so plainly
  rather than inventing a nit. He doesn't comment on everything, only on what's actually worth
  raising.
