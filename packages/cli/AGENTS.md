# packages/cli — o jogo sem tela

- `npm run sim -- <comando>`: `report`, `person`, `replay`, `scenarios`, `bench`, `director`. A lista com as opções está no topo de `src/main.ts`.
- `run.ts` (`createRun`, `runGame`, `runGameDirected`) é o mesmo laço usado pelos testes: mesma entrada = mesma cidade.
- `files.ts` é o único lugar que lê `config/`, `data/` e `scenarios/` do disco.
- Saída pensada para agentes: texto curto, em português, com números e o comando para reproduzir.
