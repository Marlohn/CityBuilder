# packages/sim — o motor

Regras deste pacote (além do `AGENTS.md` da raiz). Explicação completa: `docs/GUIA-DO-CODIGO.md`, seções 2 e 3.

- **Sem tela, sem Node:** não importe `render`, `ui`, `web`, `cli`, `bots`, `fs`, `path`, Babylon ou React. O motor roda igual no navegador e no Node.
- **Reproduzível:** sorteio só por `city.rng.<fluxo>`. Proibido `Math.random`, `Math.pow`, `Math.exp`, `Math.log`, `Math.sin`, `Date.now`.
- **Arrays, não objetos:** pessoas, famílias, prédios e carros são arrays numéricos por campo. Campo novo = array novo + crescer em `ensure`.
- **Nada fixo:** número de regra vai para `config/*.yaml` (com fonte) e `config/schema.ts`.
- **Tudo que muda a cidade é comando** (`commands/apply.ts`), senão o save/replay deixa de funcionar.
- **Nada surge do nada:** depois de mexer em pessoas, famílias ou carros, rode os testes de regras (`checkInvariants`).
- **Ordem dos sistemas** está em `game.ts`. Mudar a ordem muda a cidade: explique o motivo no PR.
- **Trabalho medido:** use `sim.perf.count(...)` em laços que crescem com a cidade.

Testes deste pacote: `packages/sim/test/`. Rode `npm test -- packages/sim`.
