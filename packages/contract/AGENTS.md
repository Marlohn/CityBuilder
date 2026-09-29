# packages/contract — o idioma entre motor e tela

- É a única ponte entre `sim` e a tela (`render`, `ui`, `web`). Não importa nenhum outro pacote do projeto.
- **Mudança aqui precisa de aprovação do dono** (CODEOWNERS): comandos, visões e mensagens mudam o formato do save e da tela.
- Comando novo: adicione no `CommandSchema` (zod) e trate em `packages/sim/src/commands/apply.ts`. Nunca mude o significado de um comando que já existe (saves antigos usam ele).
- Tipos de visão (`view.ts`) são dados prontos para desenhar/mostrar: nada de lógica aqui.
