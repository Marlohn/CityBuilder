/** Regras de camadas. Se uma regra quebrar, o CI falha. Veja docs/PLANO.md seção 4. */
module.exports = {
  forbidden: [
    {
      name: "sim-sem-tela",
      comment: "O motor (sim) não pode depender de tela, UI, CLI, bots ou do navegador/Node.",
      severity: "error",
      from: { path: "^packages/sim/src" },
      to: {
        path: "^packages/(render|ui|web|cli|bots|roadmap)/|node_modules/(@babylonjs|react|react-dom)/|^(fs|path|os|child_process|node:)",
      },
    },
    {
      name: "contract-folha",
      comment: "O contrato não depende de nenhum outro pacote do projeto.",
      severity: "error",
      from: { path: "^packages/contract/src" },
      to: { path: "^packages/(sim|render|ui|web|cli|bots|roadmap)/" },
    },
    {
      name: "tela-so-pelo-contrato",
      comment: "Tela e UI só conversam com o motor pelo contrato, nunca importando o sim direto.",
      severity: "error",
      from: { path: "^packages/(render|ui)/src" },
      to: { path: "^packages/(sim|cli|bots|roadmap)/" },
    },
    {
      name: "sem-ciclos",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    exclude: { path: "\\.test\\.ts$" },
  },
};
