# packages/contract — o idioma entre motor e tela

- É a única ponte entre `sim` e a tela (`render`, `ui`, `web`). Não importa nenhum outro pacote do projeto.
- Mudança aqui merece revisão cuidadosa porque comandos, visões e mensagens afetam motor/tela e podem afetar saves; preserve compatibilidade e cubra a alteração com os testes relevantes.
- Comando novo: adicione no `CommandSchema` (zod) e trate em `packages/sim/src/commands/apply.ts`. Nunca mude o significado de um comando que já existe (saves antigos usam ele).
- Tipos de visão (`view.ts`) são dados prontos para desenhar/mostrar: nada de lógica aqui.
