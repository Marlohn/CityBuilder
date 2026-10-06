# POC visual v4 — pacote de cidade

Assets 3D originais fornecidos pelo proprietário do CityBuilder para esta POC, sem conteúdo de terceiros.
Os arquivos GLB são preservados sem alteração de geometria ou materiais.

## Convenções do pacote

- glTF 2.0 binário (`.glb`);
- 1 unidade = 1 metro;
- lotes e peças de rua = 16 x 16 m;
- origem no centro da base, chão em y = 0;
- frente = +Z;
- asfalto em 0,02 m, calçada em 0,18 m e gramado dos lotes em 0,30 m;
- materiais PBR simples, com emissive nas janelas quando presente.

As peças de rua foram produzidas com as mesmas ligações da tabela `BASE` de
`packages/render/src/roads.ts`, portanto a POC reaproveita a lógica de vizinhança/rotação do jogo.

## Escopo

A POC é ativada apenas com `?poc=v4`. O renderer padrão, a simulação, saves/replays e o contrato não
são alterados. As camadas específicas ficam em `packages/render/src/pocV4.ts`.

O pacote-fonte inclui casas, café, loja, prédio, ruas, árvores, arbustos, mobiliário, carros e pessoas.
A v4 versiona apenas o subconjunto efetivamente carregado na cena: as seis peças viárias, duas casas,
café, loja, uma árvore, três carros, uma pessoa, banco e floreira. Os GLBs são os bytes originais do
ZIP fornecido; `SHA256SUMS.txt` registra os hashes usados para provar essa identidade.

A v4 usa esses GLBs diretamente no renderer real e mantém os modelos procedurais existentes apenas
para serviços públicos que ainda não possuem equivalente no pacote.

Origem: pacote "Pacote Assets Cidade" anexado à tarefa da POC v4 em 2026-10-06.
