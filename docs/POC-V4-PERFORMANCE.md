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

A v4 agora particiona thin instances por **chunk 16×16 tiles + modelo**. Roads, buildings, árvores e props
estáticos mantêm snapshots por chunk e só recompõem/re-enviam buffers dos chunks alterados. Veículos e
pessoas continuam dinâmicos, mas também são particionados espacialmente.

As malhas-fonte não usam mais `alwaysSelectAsActiveMesh`; cada batch espacial recalcula seu bounding info,
permitindo que o frustum culling descarte conteúdo fora da câmera. O HUD também expõe quantos chunks,
batches e instances estão visíveis e quantos uploads de buffer ocorreram.

## Perfil Web de performance

`?poc=v4&cinema=1&perf=1` ativa o perfil de benchmark:

- shadow map 2048, qualidade medium;
- MSAA 1x + FXAA;
- bloom ligado;
- SSAO desligado;
- resolução interna em 85%;
- WebGL por padrão.

Toggles de diagnóstico:

| parâmetro | exemplos |
| --- | --- |
| backend | `engine=webgl`, `engine=webgpu`, `engine=auto` |
| cenário | `stress=small`, `stress=medium`, `stress=large` |
| câmera | `view=street`, `view=medium`, `view=overview` |
| sombras | `shadows=0`, `shadows=1024`, `shadows=2048`, `shadows=4096` |
| resolução | `scale=0.75`, `scale=0.85`, `scale=1` |
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
- `poc-v4-large.png` + `poc-v4-scale-gate.json`: stress 256×256.

Esses números usam Chromium headless/SwiftShader e servem para regressão/arquitetura. A decisão final
continua sendo a medição em GPU real.
