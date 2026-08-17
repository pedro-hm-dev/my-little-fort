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

## 2. Comida consumida por dia — IMPLEMENTADO

O `foodPerDay` das unidades existia desde sempre mas nunca era consumido. Agora é.

### Modelo

`FOOD_RESOURCE_TYPES` em `app/types/Resource.ts` marca o que conta como comida: **peixe, cogumelo, carne e cacto**. O cacto entrou (o plano original não o listava) porque sem ele o bioma de deserto não tem fonte de comida nenhuma.

Store nova `app/stores/food.ts`, sem estado próprio — só computeds sobre units + inventory, mais a rotina diária:

- `dailyFoodNeed` — soma de `foodPerDay` de **todas** as unidades, abrigadas incluídas (estar no forte não dispensa comer). Party inicial = 8/dia.
- `foodStock` — total no inventário entre os tipos de comida.
- `daysOfFoodLeft`, `hasFoodShortage` — para o HUD; `Infinity`/`false` quando não há unidades.
- `starvingUnitCount` — quantas estão famintas agora.
- `consumeDailyFood()` — alimenta cada unidade uma vez, drenando **o maior estoque primeiro** (um consumo de 2 atravessa dois tipos se preciso). Quem fica sem ração recebe `starving: true` e perde **15% da vida máxima**; se a vida zerar, a unidade é desselecionada e removida. Comer de novo limpa a flag.

Um worker (50 de vida) aguenta **7 dias** sem comer antes de morrer — abrigado no forte ou não. A cura de 1%/hora do forte (`updateFortUnits` em `app/stores/units.ts`) fica **suspensa enquanto `starving`**, senão os 24%/dia de cura passariam por cima dos 15%/dia da fome e o abrigo viraria imunidade. Voltar a comer religa a cura.

`app/stores/game.ts`: `startDayWatcher` ganhou um segundo watch, em `timeStore.day`, chamando `consumeDailyFood()` na virada do dia (o primeiro watch, do horde em dusk→night, segue igual).

### Feedback visual

- **Marcador na unidade faminta**: ícone `stomach` laranja no canto superior-direito do ícone, tamanho fixo na tela (`20 / camera.zoom`, mesmo truque da barra de vida). Para isso o `app/utils/iconRenderer.ts` ganhou `STATUS_ICONS` (marcadores de status com cor própria, já entram no `preloadAllIcons`) e `drawIconSync` (desenho síncrono de um ícone por nome, não amarrado a uma entidade).
- **Contador no HUD**: `estoque/consumo` ao lado do botão de inventário, verde normalmente e vermelho em escassez, com tooltip detalhando famintos.
- **Aviso de escassez**: faixa vermelha no topo quando o estoque não cobre o dia seguinte, dizendo quanto falta.
- **Número de dano**: a perda por fome usa o mesmo `damageNumber` do combate (só para unidades no mapa — quem está no forte não é renderizado).

### Arquivos afetados

- `app/types/Resource.ts`: `FOOD_RESOURCE_TYPES`.
- `app/types/Unit.ts`: `starving?: boolean`.
- `app/stores/food.ts` (novo): computeds de comida + `consumeDailyFood`.
- `app/stores/game.ts`: watch de `timeStore.day` no `startDayWatcher`.
- `app/stores/units.ts`: cura do forte suspensa enquanto faminto.
- `app/utils/iconRenderer.ts`: `STATUS_ICONS` + `drawIconSync` + preload dos marcadores.
- `app/components/World.vue`: marcador de fome no canvas, contador e aviso no HUD.

### Adiado: recursos novos

`Egg`, `MeatWhite`, `Fat` e `LegendaryFang` **saíram deste plano** — vão entrar numa adição de recursos em batch depois, junto com cor/nome/ícone no `ResourcePanel.vue`. Quando entrarem, os comestíveis (`Egg`, `MeatWhite`, `Fat`) só precisam ser somados a `FOOD_RESOURCE_TYPES` e o consumo diário passa a usá-los sem mais nenhuma mudança de código.

---

## 3. Traço reutilizável `hostileToAll` — IMPLEMENTADO

Campo `hostileToAll?: boolean` em `app/types/Enemy.ts` — dado, não hardcoded, mesmo espírito do refactor de hábitat. `createEnemy` copia do def com o mesmo padrão de `aquatic` (`?? false`), então qualquer bicho futuro herda o comportamento só com JSON.

### Escolha de alvo

`findEnemyTarget` em `app/stores/combat.ts` buscava só no `unitGrid`. Agora, quando a flag está ligada, busca também no `enemyGrid` excluindo o próprio id e fica com **o mais próximo entre os dois** — não há preferência por unidade do jogador. O fallback de bater no forte (`behavior === "horde"`) continua no fim, inalterado.

Para isso o `SpatialGrid.findNearest` ganhou um quarto parâmetro `excludeId?: string`, espelhando o que o `hasEntityWithinRadius` já tinha. Sem ele o inimigo se acharia a si mesmo a distância 0 e nunca miraria nada.

### Perseguição (não estava no plano, mas sem isso a flag não funciona)

`updateEnemyAI` em `app/stores/enemies.ts` resolvia o alvo só com `unitStore.getUnit(...)`. Com um alvo inimigo isso devolvia `undefined`, então o bicho **adquiria o rival e ficava parado** se ele estivesse fora do alcance da arma. Passou a resolver dos dois lados:

```ts
const target = unitStore.getUnit(enemy.combatTargetId) ?? enemies.value.get(enemy.combatTargetId);
```

O leash de desistência (`MAX_CHASE_DISTANCE` / `MAX_CHASE_TIME_MS`) se aplica igual a perseguição de rival. A seção 5 vai precisar furar esse leash para o verme `enraged`.

Retaliação e dano já funcionavam para inimigo-contra-inimigo (`retaliate` e `applyDamage` sempre olharam os dois pools), então nada a fazer lá.

### Fogo amigo e loot

`updateCombat` não sabe quem desferiu o golpe fatal, então um inimigo morto por outro inimigo também deixa loot. Isso deixou de ser um problema quando o loot passou a cair no chão como carcaça — ver seção 3b: o verme limpando o deserto gera carcaças, mas o jogador ainda precisa ir buscar, o que é exatamente a ideia de "loot farm".

### Arquivos afetados

- `app/types/Enemy.ts`: campo novo.
- `app/utils/spatialGrid.ts`: `excludeId` em `findNearest`.
- `app/stores/enemies.ts`: cópia do def + resolução de alvo na perseguição.
- `app/stores/combat.ts`: `findEnemyTarget` considerando rivais.

Nenhum def em `enemyDefinitions.json` tem a flag hoje, então o comportamento em jogo está inalterado — só o `leechingWorm` do arquivo pendente a traz ligada.

---

## 3b. Loot no chão: carcaças — IMPLEMENTADO

Substitui o loot automático. Antes, matar um inimigo teleportava o loot para o inventário — o jogador não fazia nada, e um "loot farm" como o verme não valeria de nada. Agora a morte deixa um recurso coletável no mapa.

### Modelo

`ResourceType.Carcass` novo, e `Resource` ganha dois campos opcionais:

- `contents?: ResourceType[]` — o loot **já rolado**, uma entrada por unidade de `amount`, **embaralhado** (uma coleta parcial rende um mix, não só o primeiro tipo da tabela).
- `decayRemainingMs?: number` — tempo de jogo restante antes de apodrecer.

Isso faz a carcaça ser um `Resource` comum, então herda **todo** o pipeline existente de graça: hit-test de clique, comando de coletar, fila de gather, drag-select de área, halo de alvo, barra de progresso, `gatherAll`, `depleteResource` e o spatial grid.

### Morte → carcaça

`grantLoot` em `app/stores/combat.ts` virou `dropCarcass`: rola a `lootTable`, expande em itens individuais, embaralha e cria **um** `Resource` na posição da morte. Se a tabela não rolar nada (o saqueador tem 16% de chance disso), **nenhuma carcaça é criada** — não existe carcaça vazia.

Ícone vem do dado: campo `corpseIcon` novo em cada def de `enemyDefinitions.json` — bicho → `carrion`, piranha → `fish-corpse`, humanoide → `swap-bag`. Desenhada a 80% do tamanho do inimigo vivo. O `preloadAllIcons` já carrega os `corpseIcon` junto (com a cor de recurso, não de inimigo).

### Coleta

Em `updateUnitPositions`, cada tick de coleta faz `resource.contents?.shift() ?? resource.type` — a carcaça entrega o próximo item de dentro, e qualquer outro recurso segue entregando o próprio tipo. O `gatherNumber` mostra o ícone do **item real** que saiu, via `RESOURCE_ICONS` novo em `app/types/Resource.ts` (que o `ResourcePanel.vue` passou a consumir também, em vez de manter um mapa duplicado).

### Apodrecimento

**8 horas de jogo** (`CARCASS_DECAY_MS`, um terço de um dia = 100.000ms de jogo). `resourceStore.decayCarcasses(gameDeltaMs)` roda no game loop do `World.vue`, logo depois do `updateCombat`. Recursos normais do mapa não têm `decayRemainingMs` e nunca apodrecem; com o jogo pausado (`gameDeltaMs === 0`) a janela não corre.

### Interação com o sistema de comida (seção 2)

Isto **endureceu a economia de comida**: antes, matar um lobo entregava carne direto no inventário e ajudava a cobrir o consumo diário. Agora é preciso mandar alguém buscar dentro da janela de 8 horas. Caçar deixou de ser fonte passiva de comida e passou a competir por mão de obra com a coleta normal. Vale sentir em jogo antes de mexer nos números.

### Arquivos afetados

- `app/types/Resource.ts`: `Carcass`, `contents`, `decayRemainingMs`, `RESOURCE_ICONS`.
- `app/data/enemyDefinitions.json` (+ o pendente): `corpseIcon` por inimigo.
- `app/stores/combat.ts`: `dropCarcass` no lugar de `grantLoot`.
- `app/stores/resources.ts`: `decayCarcasses`.
- `app/stores/units.ts`: coleta puxando de `contents`, ícone do item no efeito.
- `app/utils/iconRenderer.ts`: preload dos `corpseIcon`.
- `app/components/World.vue`: tick do apodrecimento no loop.
- `app/components/ResourcePanel.vue`: usa `RESOURCE_ICONS`, cobre o tipo novo.

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

## 7. Unidades passivas (capivara) — PLANEJADO

Unidade que **só coleta**: não ataca, não revida, e foge quando é atacada. A primeira é a capivara (ícone `capybara`, que existe no set `game-icons`). O traço fica genérico para servir a bichos futuros (`beaver`, `donkey`, `cow`, `sheep` também estão disponíveis).

### O que já funciona sem escrever código

O jogo já trata "unidade sem arma" como caso de primeira classe, porque worker e miner são exatamente isso:

- **Não ataca**: `attackTarget` e `attackArea` em `units.ts` já pulam quem tem `combatRange <= 0 || actionIds.length === 0`.
- **Não revida**: `retaliate` em `combat.ts` já exige `unit.actionIds.length > 0` antes de virar o alvo.
- **Botão "Atacar" desabilitado**: `canAttack` na `ActionBar.vue` é `primaryCombatUnit !== null`, que procura justamente `actionIds.length > 0`.
- **Coleta**: todo o pipeline de gather é agnóstico de tipo de unidade.
- **Reprodução**: `UnitsTab.vue` monta a lista a partir do `canReproduce` do structure def, puxando label/ícone/`foodPerDay`/`reproductionTimeHours` do unit def.
- **Come todo dia**: `dailyFoodNeed` (seção 2) soma o `foodPerDay` de todas as unidades — a capivara entra sozinha na conta.

Ou seja: uma capivara que fica parada levando pancada é só **dado**. O que precisa de código é a fuga.

### O que precisa ser feito

1. `UnitType.Capybara = "capybara"` em `app/types/Unit.ts`.
2. Entrada em `unitDefinitions.json` **sem** `combatRange` e **sem** `actionIds` — o `spawnUnit` já resolve com `?? 0` e `?? []`.
3. `"capybara"` no `canReproduce` do forte em `structureDefinitions.json` (ou de uma estrutura nova — ver decisões abertas).
4. Traço `passive?: boolean` no def e no `Unit`, e o comportamento de fuga abaixo.

### Fuga ao levar dano (o único comportamento novo)

O gancho é o `retaliate` de `app/stores/combat.ts`, que hoje simplesmente sai calado quando a unidade não tem armas. Quando `unit.passive`, em vez de sair calado ele manda a unidade correr.

Dois cuidados que vão morder se forem esquecidos:

- **Limpar `targetResource` e `gatherQueue` junto**, senão nada acontece: em `updateUnitPositions` o branch de `targetResource` roda **antes** do movimento e faz `continue`, então uma capivara colhendo ignoraria o destino de fuga e continuaria parada no recurso.
- **Não travar o controle do jogador.** A recomendação é a fuga ser só um `targetPosition` comum, sem estado que bloqueie ordens — o jogador pode reordenar a capivara no mesmo instante. Um `fleeing?: boolean` cosmético serve para um marcador de status, reusando o `STATUS_ICONS`/`drawIconSync` que a seção 2 já criou.

### Decisões abertas

- **Números**: vida, velocidade, `foodPerDay`, `reproductionTimeHours` e eficiência de coleta.
- **Eficiência global ou por tipo de recurso?** Hoje `efficiency` é um multiplicador único para tudo. Se a ideia for "capivara é boa em comida/vegetal e ruim em pedra", isso exige eficiência por recurso — mudança de modelo que merece ser seu próprio item de plano, não um detalhe deste.
- **Nasce no forte ou num curral?** Os ícones `barn` e `stable` existem se a preferência for uma estrutura nova.
- **Foge para onde?** Forte mais próximo (mais útil, reusa `shelterTargetId`) ou só para o lado oposto ao atacante (mais simples, e não lota o forte).
- **Ela pode ser abrigada?** `canReproduce` é hoje o mesmo gate para reproduzir e para abrigar, então incluí-la no forte já a deixa entrar.

---

## Ordem recomendada

1. **Ataque/Defesa** (seção 1) — base isolada, sem dependência de nada do verme, dá pra validar sozinha.
2. **Comida consumida por dia** (seção 2) — independente do verme; recursos novos ficaram para um batch posterior.
3. **`hostileToAll`** (seção 3) — pequeno, testável isoladamente com qualquer inimigo existente antes do verme entrar em cena.
   - **3b. Carcaças** — loot vira recurso no chão; pré-requisito para o verme fazer sentido como loot farm.
4. **Identidade de região** (seção 4) — pré-requisito mecânico pro verme.
5. **Verme: spawn/rota/comportamento** (seção 5).
6. **Ninho: saque/respawn/UI** (seção 6) — depende de tudo acima.
7. **Unidades passivas** (seção 7) — independente do verme, pode entrar a qualquer momento.

## Verificação

- `npx nuxt typecheck` limpo depois de cada seção.
- Fórmula de Ataque/Defesa, rota de patrulha (fica dentro do polígono?), unicidade por região, escolha de saque e agendamento de respawn: tudo validável por script manipulando o estado da store direto (mesmo método usado o jogo inteiro nesta sessão) — sem depender de UI visual.
- Testes visuais (ninho no mapa, modal de escolha, verme enfurecido perseguindo) ficam com o Pedro.
