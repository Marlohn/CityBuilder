# CityBuilder

City builder isométrico no navegador, inspirado no Cities: Skylines. Cada morador tem uma vida própria: nasce, estuda, trabalha, forma família (ou não), compra carro, envelhece e morre. Regras e números da simulação usam dados reais do Brasil quando isso é relevante, com a fonte junto dos dados.

![A cidade construída pelo prefeito automático](docs/img/jogo.png)

## O que tem de diferente

- **Nada surge do nada.** Pessoas, carros e viagens têm origem, dono, destino e estado rastreável.
- **Realista e medido.** O jogo compara a cidade com referências reais e expõe um placar de realismo.
- **Leve.** A simulação roda separada da tela e possui cidades de estresse e métricas de trabalho.
- **Reproduzível.** Mesma semente + mesmas ações = mesma cidade; saves/replays ajudam a repetir bugs.
- **Desenvolvimento assistido por IA, sem orquestrador obrigatório.** O GitHub guarda contexto e histórico; o motor de roadmap mede sinais do jogo, mas qualquer humano ou IA pode implementar uma mudança diretamente.

## Jogar

```bash
npm ci
npm run dev          # abre em http://localhost:5173
```

Precisa do Node 22 ou mais novo. Como jogar: [docs/MANUAL.md](docs/MANUAL.md).

- `?seed=minha-cidade` escolhe a semente.
- `?modo=livre` liga o dinheiro infinito.

## Rodar sem tela

```bash
npm run sim -- report --bot --days=40
npm run sim -- report --bot --days=30 --save=cidade.json
npm run sim -- person 42 --bot --days=40
npm run sim -- replay bug.json
npm run sim -- bench --target=50000
```

## Desenvolver

O fluxo é propositalmente curto: **entender → implementar/testar na mesma branch → PR → CI/revisão → merge**.

```bash
npm run check        # tipos, estilo, camadas e testes Vitest
npm run test:slow    # testes de coorte/estresse
npm run test:e2e     # testes no navegador
```

| Documento | Para quê |
|---|---|
| [docs/VISAO.md](docs/VISAO.md) | O que o jogo é e o que não é |
| [docs/PLANO.md](docs/PLANO.md) | Decisões, arquitetura e fontes |
| [docs/GUIA-DO-CODIGO.md](docs/GUIA-DO-CODIGO.md) | Onde fica cada coisa e receitas de código |
| [AGENTS.md](AGENTS.md) | Regras enxutas para humanos e IAs |
| [ROADMAP.md](ROADMAP.md) | Priorização gerada a partir dos sinais do jogo e das issues |

Estrutura: `packages/sim` é o motor (sem tela), `packages/web` junta o jogo no navegador e a comunicação passa por `packages/contract`.

## Ideias e bugs

- **Ideia:** abra uma issue "💡 Ideia" livremente. Ela pode ser ligada ao roadmap quando fizer sentido.
- **Bug:** descreva a reprodução; se houver replay exportado pelo jogo, anexe-o.

## Automação do repositório

- `ci.yml` roda validações proporcionais ao risco: check normal sempre que há código, testes lentos para núcleo da simulação e E2E para caminhos visuais/integração.
- `pages.yml` publica a `main` no GitHub Pages.
- `roadmap.yml` atualiza os sinais e a visão do roadmap.
- `branch-hygiene.yml` remove somente branches comprovadamente obsoletas e preserva POCs.

## Licenças

- Código: Apache 2.0 ([LICENSE](LICENSE)).
- Modelos 3D: [Kenney](https://kenney.nl), CC0 (`packages/web/public/models/LICENSE.md`).
- Dados: IBGE e demais fontes citadas em `config/` e `data/`.
