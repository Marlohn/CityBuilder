# POC v4 — gate de escala Web

Esta página documenta o experimento da issue #320. O objetivo é decidir, com o mesmo hardware/browser,
se a direção visual v4 tem margem real para continuar no Babylon/Web.

> **Status:** implementação técnica em validação. A decisão final permanece pendente do teste manual
> obrigatório em GPU real; CI/headless não decide o gate de produto.

## Baseline recuperado da #319

O artefato final da POC v4 original (`b03875d8d151e2cf30718f6c9b609c5116da51c9`) registrou:

| cenário | backend | prédios | FPS | meshes | active meshes | observação |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| small/hero | Chromium headless + SwiftShader | 22 | 32 | 26 | 15 | alarme de regressão apenas; não é benchmark de GPU real |

A configuração hero original usa shadow map 4096, PCF high, MSAA 4x, FXAA, bloom e SSAO2.

## Mudança estrutural

A v4 particiona o estado de thin instances em **chunks 16×16 tiles no CPU**. Roads, buildings, árvores e
props estáticos mantêm snapshots por chunk e só recompõem os chunks alterados. Veículos e pessoas continuam
dinâmicos, mas também são classificados espacialmente.

Um detalhe do Babylon muda a implementação GPU: clones de um Mesh compartilham a mesma `Geometry`, e os
buffers de thin instances pertencem à `Geometry`. Portanto não é correto manter um buffer independente de
thin instances em cada clone de chunk sem duplicar a geometria. Duplicar milhares de geometrias destruiria
o objetivo de escala.

A solução adotada mantém **uma Geometry/mesh por modelo** e compacta, para esse mesh, somente as matrizes
dos chunks que realmente intersectam a projeção do frustum da câmera no chão, com margem curta de segurança.
O buffer GPU só é recomposto quando a janela de chunks muda ou quando um chunk visível muda. Props pequenos
(bancos/floreiras), árvores e veículos/pessoas também têm distância máxima no perfil de escala, evitando desenhar
detalhe subpixel no horizonte. Assim:

- geometria/material/submeshes dos GLBs permanecem exatamente os originais;
- chunks fora da janela não entram no buffer GPU;
- chunks estáticos inalterados não provocam upload;
- o número de meshes não cresce com a cidade;
- o HUD continua medindo chunks/batches/instances totais e visíveis, além dos uploads de buffer.

As malhas-fonte v4 deixam de usar `alwaysSelectAsActiveMesh`; o bounding agregado passa a representar
somente o subconjunto visível compactado.

## Perfil Web de performance

`?poc=v4&cinema=1&perf=1` ativa o perfil de benchmark:

- shadow map 1024, qualidade low;
- MSAA 1x + FXAA;
- bloom ligado;
- SSAO desligado;
- resolução interna em 75%;
- WebGL por padrão.

Toggles de diagnóstico:

| parâmetro | exemplos |
| --- | --- |
| backend | `engine=webgl`, `engine=webgpu`, `engine=auto` |
| cenário | `stress=small`, `stress=medium`, `stress=large` |
| câmera | `view=street`, `view=medium`, `view=overview` |
| sombras | `shadows=0`, `shadows=1024`, `shadows=2048`, `shadows=4096` |
| resolução | `scale=0.5`, `scale=0.75`, `scale=0.85`, `scale=1` |
| anti-alias | `msaa=1`, `msaa=2`, `msaa=4` |
| pós | `ssao=1`, `bloom=0` |

O WebGPU é opt-in. Quando solicitado e indisponível/falhar ao inicializar, o renderer volta automaticamente
para WebGL e registra o fallback no HUD.

## Stress scenes determinísticas

- **small:** composição original 30×26, 22 lotes;
- **medium:** 128×128, alvo de 1.500 lotes e 500 veículos/pessoas;
- **large:** 256×256, alvo de 6.000 lotes e 1.500 veículos/pessoas.

As cenas `cinema=1` não dependem do Worker. O caminho `?poc=v4` continua exercitando Worker, simulação
real e UI separadamente.

## Métricas

O HUD e `window.__city.performance()` expõem:

- backend efetivo e fallback;
- FPS, frame time médio, p95 e p99;
- resolução interna/hardware scaling;
- meshes/active meshes, draw calls, triângulos e vértices;
- chunks/batches/instances totais e visíveis;
- uploads de buffers;
- perfil gráfico ativo.

Os testes E2E verificam ainda que reaplicar o mesmo mapa/prédios estáticos causa **zero uploads adicionais**.

## Protocolo do gate manual

Executar no mesmo computador e navegador onde a lentidão da v4 original foi percebida. Para cada cenário,
deixar estabilizar alguns segundos, mover/rotacionar/zoom e registrar FPS, frame médio, p95/p99 e percepção
visual.

| cenário | alvo de referência |
| --- | --- |
| small | ~60 FPS |
| medium | >= 45 FPS sustentados |
| large/medium | >= 30 FPS sustentados no pior enquadramento razoável |
| navegação normal | evitar picos recorrentes > 50 ms |

Comparar WebGL e WebGPU no mesmo `stress/view`. A decisão só é **CONTINUAR WEB** se a cidade grande
continuar jogável, o custo acompanhar principalmente conteúdo/chunks visíveis e a qualidade permanecer
próxima da v4 aprovada. Caso contrário, a conclusão da #320 é **MIGRAR PARA GODOT C# DESKTOP**.

## Evidência automatizada

O workflow `POC visual v4 preview` gera, para cada HEAD da PR:

- `poc-v4-city.png` + `poc-v4-performance.json`: hero/small;
- `poc-v4-tuned-small.png` + `poc-v4-performance-tuned-small.json`: perfil Web/small;
- `poc-v4-scale-gate.json`: stress 256×256. A captura automática dessa cena é omitida porque o
  screenshot do canvas em SwiftShader bloqueia por minutos; a captura visual grande fica para o navegador/GPU real.

Esses números usam Chromium headless/SwiftShader e servem para regressão/arquitetura. A decisão final
continua sendo a medição em GPU real.
