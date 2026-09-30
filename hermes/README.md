# Agentes no Hermes

> **O que está rodando hoje (container, sincronizador, regras, armadilhas):** [OPERACAO.md](OPERACAO.md).

Quatro perfis prontos do [Hermes Agent](https://github.com/NousResearch/hermes-agent), um por papel:

| Perfil | Papel | Instruções |
|---|---|---|
| `cb-designer` | Decide **o que** fazer: sinais do jogo e ideias viram itens do roadmap, com pesquisa | `agents/designer.md` |
| `cb-arquiteto` | Decide **como**: quebra itens em tarefas pequenas e revisa os PRs | `agents/arquiteto.md` |
| `cb-revisor` | Revisa os PRs: CI verde sobre a main atual + regras = merge, ou pede mudanças | `agents/arquiteto.md` (seção de revisão) |
| `cb-qa` | Escreve o teste que falha **antes** do código e caça bugs | `agents/qa.md` |
| `cb-dev` | Faz os testes passarem | `agents/dev.md` |

Cada pasta é uma "distribuição de perfil" do Hermes: `SOUL.md` (quem o agente é e o ciclo dele), `config.yaml` (pasta de trabalho, limite de passos) e `distribution.yaml` (nome e o que precisa de chave). O modelo de IA você escolhe na instalação: dá para usar um modelo grátis diferente para cada papel.

Formato conferido na documentação oficial do Hermes (perfis, distribuições, cron e arquivos de contexto) em setembro de 2026.

## 1. Preparar o GitHub (uma vez)

```bash
gh auth login
bash tools/setup-github.sh     # cria as etiquetas do fluxo (ideia, roadmap, pronto-pra-dev...)
```

Crie um token do GitHub para os agentes (fine-grained, só este repositório, com permissão de Issues, Pull requests e Contents). Todos podem usar o mesmo token, ou um por agente se você quiser saber quem fez o quê.

## 2. Um clone por agente

Cada agente precisa da **sua própria cópia** do repositório. Se dois agentes usarem a mesma pasta, um troca a branch do outro no meio do trabalho.

```bash
for p in designer arquiteto revisor qa dev; do
  git clone https://github.com/Marlohn/CityBuilder.git ~/cb/$p
  (cd ~/cb/$p && npm ci)
done
```

## 3. Instalar os perfis

De dentro de um dos clones:

```bash
for p in designer arquiteto revisor qa dev; do
  hermes profile install ./hermes/$p --alias        # cria o perfil cb-<papel> e o comando cb-<papel>
  cb-$p setup                                        # escolhe o modelo e as chaves
  cb-$p config set terminal.cwd ~/cb/$p              # pasta de trabalho = o clone dele (caminho absoluto)
done
```

Coloque o `GH_TOKEN` no `.env` de cada perfil: o instalador cria `~/.hermes/profiles/cb-<papel>/.env.EXAMPLE`; copie para `.env` na mesma pasta e preencha.

Teste um ciclo na mão:

```bash
cb-designer chat -q "Faça um ciclo do seu papel."
```

## 4. Ligar o loop (24h)

O Hermes roda tarefas agendadas pelo gateway. Um gateway por perfil:

```bash
for p in designer arquiteto revisor qa dev; do cb-$p gateway install; done
```

Agende o ciclo de cada papel. **Use `--workdir`**: sem ele, a tarefa agendada não carrega o `AGENTS.md` do projeto.

```bash
PROMPT="Faça um ciclo do seu papel, como está no seu SOUL.md. Uma tarefa só. Sem trabalho, pare."
cb-designer  cron create "every 1d at 07:00" "$PROMPT" --workdir ~/cb/designer
cb-arquiteto cron create "every 4h"          "$PROMPT" --workdir ~/cb/arquiteto
cb-qa        cron create "every 2h"          "$PROMPT" --workdir ~/cb/qa
cb-dev       cron create "every 1h"          "$PROMPT" --workdir ~/cb/dev
```

Os intervalos são uma sugestão: o Dev roda mais porque é quem tem mais trabalho. Confira com `cb-dev cron status`.

## 5. Atualizar os perfis

Quando os arquivos desta pasta mudarem (`git pull` no clone):

```bash
for p in designer arquiteto revisor qa dev; do hermes profile update cb-$p; done
```

A memória, as conversas e as chaves de cada agente não são tocadas. O `config.yaml` é mantido (o seu `terminal.cwd` continua).
Se o `update` reclamar da origem, reinstale por cima: `hermes profile install ./hermes/<papel> --force` (aí o `config.yaml` volta ao da pasta e você refaz o `terminal.cwd`).

## Juízes que não são IA

- **CI:** nada entra com `npm run check` vermelho, e o Dev não consegue mexer nos testes do QA.
- **Você:** mudanças no contrato, formato de save, schema da config e `docs/VISAO.md` precisam da sua aprovação (CODEOWNERS). Ative a proteção da branch `main` para isso valer (veja o README).
- **Motor de roadmap:** a ordem do trabalho sai da fórmula, não da opinião de um modelo.
