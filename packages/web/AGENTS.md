# packages/web — o jogo no navegador

- `worker.ts` roda o motor num Web Worker (a tela nunca trava por causa da simulação). A conversa com a tela segue as mensagens de `@city/contract` (`messages.ts`).
- `tools.ts` define as ferramentas da barra (vias, zonas, serviços). Ferramenta nova = comando que já existe no contrato.
- Modelos 3D em `public/models/` (Kenney, CC0, veja a LICENSE de lá). Não adicione modelo sem licença livre.
- URL: `?seed=abc` escolhe a semente, `?modo=livre` liga o dinheiro infinito.
- Testar: `npm run dev`, `npm run build` e `npm run test:e2e`.
