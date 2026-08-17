# Verme de areia (semi-boss territorial) e sistema de Ataque/Defesa

> Plano pendente de implementação — salvo no repo pra poder retomar em qualquer máquina. Ver commits recentes pro estado atual do jogo (habitat de inimigos guiado por dado, biomas em regiões, etc.) antes de implementar, caso algo já tenha mudado.

## Contexto

Depois do refactor de hábitat dos inimigos (dado em vez de código, ver `enemyDefinitions.json` + `enemies.ts`), o Pedro adicionou duas entradas novas na definição — `leechingWorm` (type `sandWorm`, `behavior: "territorial"`, ação `"swallow"`) e `dustDevil` — sem lógica de código nenhuma por trás. `dustDevil` já foi resolvido (hábitat deserto, ambient normal). `leechingWorm` é um semi-boss com uma mecânica bem mais rica: patrulha uma rota dentro do bioma de origem, ataca qualquer coisa (jogador ou outro inimigo), tem um ninho com baú, é único por região de bioma (não por tipo — 2 desertos no mapa = até 2 vermes), e o jogador pode saquear o ninho a qualquer momento com 3 escolhas (ovos / baú+manter / cancelar), cada uma com consequência diferente no respawn. Junto, o Pedro pediu um sistema global de Ataque/Defesa pra unidades e inimigos.

Decisões confirmadas nas perguntas de esclarecimento:

- **Hostilidade**: `hostileToAll` vira um traço de dado reutilizável (não hardcoded pro verme) — qualquer inimigo futuro pode herdar esse comportamento só com JSON.
- **Gatilho do saque**: o jogador pode clicar no ninho a **qualquer momento**, verme vivo ou não. Se o verme estiver vivo, isso o deixa imediatamente agressivo e focado no jogador (ignora o leash normal de perseguição).
- **Ataque/Defesa**: já entram com valores base por tipo agora (não fica tudo em 0) — números propostos abaixo, ajustáveis depois de ver em jogo.
- **Recurso "ovo"**: categoria comida, junto de carne/carne branca/cogumelo/peixe/gordura — sem mecanismo de consumo ainda (o `foodPerDay` das unidades também não é consumido hoje), só uma tag pra quando essa mecânica existir.

Isso substitui o plano anterior (fôlego/habilidades/DRY) como foco desta rodada — aqueles itens continuam no backlog, não descartados, só não fazem parte deste plano.

---

## 1. Ataque/Defesa — IMPLEMENTADO (modelo estilo League of Legends + dados de RPG)

### Modelo

`Combatant` (`app/types/Combat.ts`) ganha `attack: number` (stat plano, não percentual) e `defense: number` (pontos de armadura). `Unit` (`app/types/Unit.ts`) ganha os mesmos dois campos diretamente.

`ActionDefinition` troca `damage: [number, number]` por **`damage: string`** em notação de dado de RPG mais **`scaling: number`** — o percentual do `attack` do atacante que entra no golpe. O dano base é **rolagem pura, sem bônus flat** (`"2d10"`, `"4d6"` — nunca `"2d6+4"`). Roller novo em `app/utils/dice.ts` (`parseDice`/`rollDice`/`diceRange`, com cache do parse e erro alto em notação inválida); o parser aceita modificador (`+X`) por ser notação padrão, mas nenhuma ação usa.

Fórmula em `app/utils/combatEngine.ts`, `rollDamage(action, attackerAttack, defenderDefense)`:

```
base        = rollDice(action.damage)
escalado    = base + attackerAttack * action.scaling / 100
preArmadura = crit ? escalado * critMultiplier : escalado
final       = preArmadura * DEFENSE_HALVING_POINT / (DEFENSE_HALVING_POINT + defense)
```

`DEFENSE_HALVING_POINT = 100`: a defesa vira redução com retorno decrescente, assintótica a 100% sem nunca chegar (defesa 15 → 13,0%; 30 → 23,1%; 100 → 50%; 1000 → 90,9%). Defesa negativa é clampada em 0, então nunca amplifica dano. Crit multiplica **antes** da armadura.

`app/stores/combat.ts`: `Target` ganha `defense` (resolvido junto da entidade, sem busca extra; estrutura → 0, não tem o stat), e tanto `applyImpact` quanto o splash de AOE passam `attacker.attack` + a defesa do alvo pro `rollDamage`.

### Dados por ação

Dado puro preservando a média base anterior. Scaling calibrado para **média 70 em melee e 50 em ranged** — ataque à distância escala menos com o stat de ataque.

| Ação          | Tipo   | Dado   | Range  | Média base | Scaling |
| ------------- | ------ | ------ | ------ | ---------- | ------- |
| thrust        | melee  | `2d10` | [2,20] | 11,0       | 60%     |
| slash         | melee  | `4d6`  | [4,24] | 14,0       | 80%     |
| clubSmash     | melee  | `2d12` | [2,24] | 13,0       | 70%     |
| bite          | melee  | `2d8`  | [2,16] | 9,0        | 55%     |
| lungeBite     | melee  | `2d6`  | [2,12] | 7,0        | 60%     |
| maul          | melee  | `3d10` | [3,30] | 16,5       | 95%     |
| arrowShot     | ranged | `2d8`  | [2,16] | 9,0        | 55%     |
| bombArrowShot | ranged | `4d8`  | [4,32] | 18,0       | 40%     |
| hookShot      | ranged | `3d4`  | [3,12] | 7,5        | 55%     |

### Valores aplicados (ajustar depois de testar)

| Unidade | Ataque | Defesa |
| ------- | ------ | ------ |
| Worker  | 0      | 0      |
| Soldier | 10     | 15     |
| Archer  | 15     | 0      |
| Hunter  | 8      | 5      |
| Miner   | 0      | 5      |

| Inimigo                  | Ataque | Defesa |
| ------------------------ | ------ | ------ |
| Raider                   | 5      | 5      |
| RaiderArcher             | 8      | 0      |
| Wolf                     | 8      | 0      |
| Piranha                  | 5      | 0      |
| Bear                     | 15     | 10     |
| Tiger                    | 18     | 5      |
| DustDevil                | 10     | 5      |
| **SandWorm (semi-boss)** | **35** | **30** |

O verme está fora do jogo por enquanto — ver "Verme desativado" abaixo.

### Arquivos afetados

- `app/types/Combat.ts`, `app/types/Unit.ts`: campos novos + `damage`/`scaling` em `ActionDefinition`.
- `app/utils/dice.ts` (novo): parse e rolagem de notação de dado.
- `app/data/unitDefinitions.json`, `app/data/enemyDefinitions.json`: valores acima.
- `app/data/actionDefinitions.json`: dados + scaling por ação.
- `app/stores/units.ts` (`spawnUnit`), `app/stores/enemies.ts` (`createEnemy`): copiar do def pro runtime, mesmo padrão de `combatRange`/`actionIds` já existente.
- `app/utils/combatEngine.ts`, `app/stores/combat.ts`: fórmula + resolução de defesa do alvo.

### Verme desativado

A entrada `leechingWorm` saiu de `enemyDefinitions.json` e está guardada em **`app/data/enemyDefinitions.pending.json`** — nenhum código importa esse arquivo, então ele não afeta o jogo. Motivo: `behavior: "territorial"`, a ação `swallow` e os recursos de loot (`fat`/`meatWhite`/`legendaryFang`) ainda não existem em código.

Ao implementar as seções 5 e 6, mover a entrada de volta pro `enemyDefinitions.json` **depois** de: `swallow` em `actionDefinitions.json` (com `damage` em dado + `scaling`), os recursos novos em `ResourceType` (seção 2) e o branch `territorial` no `updateEnemyAI`. O arquivo pendente já vem com `attack`/`defense`, `hostileToAll` e `habitat` de deserto preenchidos.

---

## 2. Recursos novos (ovo + loot do verme) — pequeno, sem mecânica nova

`app/types/Resource.ts`: adiciona `Egg`, `MeatWhite`, `Fat`, `LegendaryFang` ao `ResourceType`. Nenhum entra em `resourceDefinitions.json` (esses são só drop de loot, mesmo padrão que `Meat`/`Leather` já usam hoje — nunca nascem como nó no mapa). Novo array exportado `FOOD_RESOURCE_TYPES` (em `types/Resource.ts`) marcando quais tipos contam como comida — hoje: Fish, Mushroom, Meat, MeatWhite, Fat, Egg — só a tag, sem consumidor ainda (consistente com `foodPerDay` também não ser consumido). `app/components/ResourcePanel.vue`: cor/nome/ícone pros 4 tipos novos (ícones do set `game-icons` já usado: `egg`, algo tipo `meat`/variação clara pra white meat, `fat`/gordura, e um ícone de presa/troféu pra `legendaryFang` — escolher na hora da implementação).

---

## 3. Traço reutilizável `hostileToAll`

Campo `hostileToAll?: boolean` em `app/types/Enemy.ts` (dado, não hardcoded — mesmo espírito do refactor de hábitat). Em `app/stores/combat.ts`, `findEnemyTarget(enemy)`: hoje só busca no `unitGrid` (unidades do player). Quando `enemy.hostileToAll` é true, busca também no `enemyGrid` (já reconstruído por frame pelo D-perf, excluindo o próprio id) e escolhe o mais próximo entre as duas listas. Isso não muda o comportamento de nenhum inimigo hoje (só o verme vai ter a flag), mas fica pronto pra qualquer bicho futuro.

---

## 4. Regiões de bioma precisam de identidade estável

Hoje `biomeRegions` é um array interno de `app/stores/world.ts`, nunca exposto pela store, sem id. Pra "um verme por região" funcionar preciso:

- Adicionar `id: string` em `BiomeRegion` (ex: `${biome}-${index}` na geração).
- Expor `biomeRegions` no retorno da store (`useWorldStore()`), do jeito que `lakes`/`rivers` já são.

Isso é a única mudança em `world.ts` — o resto do sistema de verme vive em `enemies.ts` + uma store nova.

---

## 5. Verme de areia: patrulha, ninho, ninho único por região

### Spawn (uma vez por região do bioma, não pelo rolamento ambient)

Diferente de lobo/urso/tigre (que usam o rolamento probabilístico `spawnAmbient`), o verme é `behavior: "territorial"` — isso já significa "semi-boss com ninho", sem precisar de uma flag extra. Na inicialização (`enemies.ts`, chamado depois que `world.ts` gerou as `biomeRegions`): para cada def com `behavior === "territorial"`, para cada `BiomeRegion` cujo `.biome` bate com o `habitat.biome` do def (verme usa `habitat: {kind:"biome", biome:"desert"}`, reaproveitando o mesmo tipo `EnemyHabitat` do refactor anterior), gera exatamente um verme + um ninho.

### Rota de patrulha

Dentro do polígono da região (`region.outline`, já tenho `pointInPolygon` em `utils/geometry.ts`): amostragem por rejeição — sorteia pontos dentro da bounding box da região, mantém os que caem dentro do polígono, até ter uns 5-7 waypoints. Ordena esses pontos por ângulo em torno do centróide da região (truque padrão pra fechar um laço sem se autocruzar). O **ninho** fica no centróide desses waypoints ("no meio da rota").

### Comportamento (`app/stores/enemies.ts`, `updateEnemyAI`, novo branch `behavior === "territorial"`)

Estados (novos campos runtime em `Enemy`, `app/types/Enemy.ts`): `patrolRoute?: Position[]`, `patrolIndex?: number`, `nestPosition?: Position`, `resting?: boolean`, `enraged?: boolean`.

- **Patrulhando** (padrão): anda de waypoint em waypoint em loop. Como `hostileToAll: true`, o auto-aggro por proximidade do combat.ts já cuida de brigar com qualquer coisa (jogador ou outro inimigo) que chegue perto — não precisa de lógica de ataque nova aqui, só o alcance/`actionIds` de sempre.
- **Ferido e fora de combate**: quando `!combatTargetId && health < maxHealth`, em vez de continuar a rota, vira `resting: true` e anda até `nestPosition`. Lá, regenera (ex: 2% da vida máxima por segundo) até full ou até ser interrompido por combate de novo; ao curar, `resting: false` e retoma a rota de onde parou.
- **Enfurecido** (raid do ninho com o verme vivo — ver seção 6): `enraged: true` força o alvo pro jogador mais próximo (ou o forte, se não achar unidade) e ignora `MAX_CHASE_DISTANCE`/`MAX_CHASE_TIME_MS` (o leash de desistência que já existe) enquanto durar — as unidades vão realmente precisar lutar ou fugir, não só esperar ele desistir.

### Arquivos afetados

- `app/types/Enemy.ts`: `behavior` ganha `"territorial"`; campos de patrulha/ninho/enraged acima; `hostileToAll`.
- `app/stores/world.ts`: id + export de `biomeRegions`.
- `app/stores/enemies.ts`: geração de rota, spawn único por região, branch de movimento territorial.
- `app/stores/combat.ts`: busca no `enemyGrid` quando `hostileToAll`.

---

## 6. Ninho: entidade, saque, escolha do jogador, respawn

### Nova store `app/stores/wormNests.ts`

```ts
interface WormNest {
  id: string;
  regionId: string;       // qual BiomeRegion
  position: Position;      // = nestPosition do verme
  wormEnemyId: string | null; // id do verme vivo atual, se houver
  state: "unclaimed" | "cooldown"; // "unclaimed" = baú disponível pra escolha
  respawnAtDay: number | null;     // quando volta a existir um verme aqui
}
```

- `initialize()`: um nest por verme gerado (seção 5).
- `raid(nestId, choice: "eggs" | "loot" | "cancel")`:
  - `"eggs"`: `inventoryStore.addResource(Egg, rolagem generosa ex. 15-30)`; agenda respawn em `baseWeeks * 3` (200% a mais, não acumulado — sempre 3x a base, nunca 9x).
  - `"loot"`: aplica um novo `nestLoot: LootDrop[]` do def do verme (separado do `lootTable` de combate normal — matar o verme em combate dropa o de sempre; saquear o ninho dropa esse outro, mais temático de tesouro: fat/meatWhite/legendaryFang). Agenda respawn em `baseWeeks` (1 semana = 7 dias de jogo).
  - `"cancel"`: não muda nada, baú continua disponível.
  - Em qualquer escolha que não seja cancelar: se `wormEnemyId` aponta pra um verme ainda vivo, seta `enraged: true` nele (consequência confirmada: saquear com o verme vivo o deixa agressivo).
- `checkRespawns(day)`: chamado do mesmo watcher de dia que já existe (`app/stores/game.ts`, `startDayWatcher`) — quando `day >= respawnAtDay`, gera um novo verme na região (nova rota, reaproveita o `nestPosition`) e volta o nest pra `state: "unclaimed"` já apontando pro novo verme (o baú também "reabastece" nesse momento, pronto pra ser saqueado de novo).

### UI: escolha ao clicar no ninho

`app/components/World.vue`: ninho renderizado com ícone de baú (`locked-chest` normalmente, `open-treasure-chest` se `state==="cooldown"`), no mesmo laço que já desenha estruturas/recursos. Clique nele (mesmo padrão de hit-test já usado pra unidade/estrutura/recurso) abre um modal novo, `app/components/NestRaidModal.vue` (reaproveitando `UModal` do Nuxt UI, como o resto do app já usa `USlideover`/`UTooltip`): 3 botões — Coletar ovos / Manter e saquear / Cancelar — chamando `wormNestsStore.raid(...)`. Se `state==="cooldown"`, o modal só informa "respawna no dia X" em vez das opções.

### Arquivos afetados

- `app/stores/wormNests.ts` (novo).
- `app/data/enemyDefinitions.json`: `nestLoot` no `leechingWorm`.
- `app/components/World.vue`: render do ninho + hit-test de clique.
- `app/components/NestRaidModal.vue` (novo).
- `app/stores/game.ts`: chamar `wormNestsStore.checkRespawns(day)` no watcher de dia já existente.

---

## Ordem recomendada

1. **Ataque/Defesa** (seção 1) — base isolada, sem dependência de nada do verme, dá pra validar sozinha.
2. **Comida consumida por dia** (seção 2) — independente do verme; recursos novos ficaram para um batch posterior.
3. **`hostileToAll`** (seção 3) — pequeno, testável isoladamente com qualquer inimigo existente antes do verme entrar em cena.
4. **Identidade de região** (seção 4) — pré-requisito mecânico pro verme.
5. **Verme: spawn/rota/comportamento** (seção 5).
6. **Ninho: saque/respawn/UI** (seção 6) — depende de tudo acima.

## Verificação

- `npx nuxt typecheck` limpo depois de cada seção.
- Fórmula de Ataque/Defesa, rota de patrulha (fica dentro do polígono?), unicidade por região, escolha de saque e agendamento de respawn: tudo validável por script manipulando o estado da store direto (mesmo método usado o jogo inteiro nesta sessão) — sem depender de UI visual.
- Testes visuais (ninho no mapa, modal de escolha, verme enfurecido perseguindo) ficam com o Pedro.
