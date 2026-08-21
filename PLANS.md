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

### Verme ativado

O def do verme viveu um tempo em `app/data/enemyDefinitions.pending.json`, fora do jogo, porque `behavior: "territorial"`, a ação `swallow` e os recursos de loot não existiam em código. **Tudo isso entrou na seção 5**, e o arquivo pendente foi removido — o verme está no `enemyDefinitions.json` sob a chave `sandWorm`.

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

**Sem avisos de consumo na tela** — nada de contador de estoque nem faixa de "falta comida". O único indicador é o **marcador na unidade faminta**: ícone `stomach` laranja no canto superior-direito do ícone dela, em tamanho fixo na tela (`20 / camera.zoom`, mesmo truque da barra de vida). Para isso o `app/utils/iconRenderer.ts` ganhou `STATUS_ICONS` (marcadores de status com cor própria, já entram no `preloadAllIcons`) e `drawIconSync` (desenho síncrono de um ícone por nome, não amarrado a uma entidade).

A perda de vida por fome usa o mesmo `damageNumber` do combate, só para unidades no mapa (quem está no forte não é renderizado).

A store expõe `dailyFoodNeed`, `foodStock` e `starvingUnitCount` como estado consultável — sem consumidor na UI hoje, mas é a superfície que os testes usam e que qualquer HUD futuro vai querer.

### Arquivos afetados

- `app/types/Resource.ts`: `FOOD_RESOURCE_TYPES`.
- `app/types/Unit.ts`: `starving?: boolean`.
- `app/stores/food.ts` (novo): computeds de comida + `consumeDailyFood`.
- `app/stores/game.ts`: watch de `timeStore.day` no `startDayWatcher`.
- `app/stores/units.ts`: cura do forte suspensa enquanto faminto.
- `app/utils/iconRenderer.ts`: `STATUS_ICONS` + `drawIconSync` + preload dos marcadores.
- `app/components/World.vue`: marcador de fome no canvas.

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

## 4. Regiões de bioma: identidade estável e contagem por bioma — IMPLEMENTADO

`BiomeRegion` era uma interface **privada** do `app/stores/world.ts`, e o array nunca era exposto. Agora:

- **`BiomeRegion` virou tipo público** em `app/types/Terrain.ts`, ao lado de `Lake` e `BiomeType`, com um campo **`id`** novo.
- **`id` no formato `${biome}-${n}`**, com `n` contando de 0 por bioma (`desert-0`, `desert-1`, `forest-0`). O ordinal vem de **quantas regiões daquele bioma já foram colocadas**, não do índice do loop — `tryPlaceBiomeRegion` pode falhar em achar espaço e devolver `null`, então o índice do loop deixaria buracos na numeração.
- **`biomeRegions` exposto** no retorno da store, como `lakes`/`rivers` já eram.

### Contagem e consulta

- **`regionCountByBiome`** (computed, `Record<BiomeType, number>`): inicializa **todo** `BiomeType` em 0 antes de contar, então `regionCountByBiome.desert === 0` distingue "este mapa não sorteou deserto" de "campo ausente" — que era exatamente o caso silencioso. Grassland é o preenchimento default, nunca uma região colocada, então dá sempre 0.
- **`regionsOfBiome(biome)`**: as regiões daquele tipo.
- **`regionAt(x, y)`**: a região que contém o ponto, ou `null` em Grassland. Não estava no plano, mas as seções 5 e 8 precisam da *região* e não só do bioma — sem isso cada consumidor reimplementaria o `regionContains`, que é privado.

Com isso o cap da seção 8 fica um número inspecionável: `biomeCap × regionCountByBiome[biome]`.

**Não adicionei `bounds` à `BiomeRegion`** (como fiz para `Lake`). O `regionContains` já faz descarte por raio antes do polígono, e regiões são blobs aproximadamente circulares — ao contrário de rios, onde o raio cobria todo o comprimento e não rejeitava nada. Sem medição que mostre custo, seria otimização prematura.

### Painel de debug

O painel do canto (que mostrava ZOOM/PAN/SEED) ganhou uma linha `BIOMAS` com a contagem por bioma (`FLO 1 · DES 2 · TUN 1 · MON 1`), para dar visibilidade imediata do que o mapa gerou na hora de balancear spawn.

### Arquivos afetados

- `app/types/Terrain.ts`: `BiomeRegion` pública com `id`.
- `app/stores/world.ts`: geração do `id`, `biomeRegions` exposto, `regionCountByBiome`, `regionsOfBiome`, `regionAt`.
- `app/components/World.vue`: linha `BIOMAS` no painel de debug.

---

## 5. Verme de areia: patrulha e comportamento territorial — IMPLEMENTADO

O ninho como **entidade saqueável** é a seção 6; aqui ele existe só como ponto de descanso do verme.

### Pré-requisitos que faltavam

- **`ResourceType.Fat` e `ResourceType.LegendaryFang`** (o Pedro já tinha adicionado `Algae` e `WhiteMeat`), com ícones `fat` e `bestial-fangs`. `Fat` entrou em `FOOD_RESOURCE_TYPES`; `LegendaryFang` não — é troféu.
- **Ação `swallow`** em `actionDefinitions.json`: melee, `4d10` com scaling 90%, cooldown 2600ms, animação 900ms. Com `attack: 35` dá ~53 de dano médio, ~46 contra um soldado — dois a três golpes, o que é o peso esperado de um semi-boss.
- **`EnemyType.SandWorm`** e `behavior: "territorial"` no tipo `Enemy`.
- O loot do def dizia `meatWhite`, mas o enum é `whiteMeat` — **corrigido**, senão o loot cairia como tipo inválido.
- `ResourcePanel.vue` ganhou as quatro entradas que faltavam nos `Record<ResourceType, string>` (`algae`, `whiteMeat`, `fat`, `legendaryFang`). Isso **destravou o typecheck**, que estava vermelho desde o commit `cf9928b`.

### Bug encontrado: a chave do def divergia do `type`

O def do verme tinha chave `leechingWorm` e `type: "sandWorm"`. **Todo** o código indexa os defs pela chave (`createEnemy`, `ambientCapFor`, `spawnAmbient`, `dropCarcass` fazem `enemyDefs[type]`), então o verme dava `undefined` e o spawn quebrava com `Cannot read properties of undefined`.

Os outros doze defs seguem chave === type. Alinhei a **chave** para `sandWorm`, preservando o `type` que o plano e o código usam (`EnemyType.SandWorm`). O nome "leeching worm" sobrevive no `iconName: "leeching-worm"`. Se a intenção era chave-como-variante e type-como-espécie (dois vermes diferentes com `type: "sandWorm"`), então o lookup por type é ambíguo por construção e o identificador de runtime teria que passar a ser a chave — refactor de `EnemyType` inteiro, que não fiz.

### Rota de patrulha: `app/utils/patrol.ts` (novo)

`generatePatrolRoute(outline, waypointCount, random?)`:

1. **Amostragem por rejeição** na bounding box do outline (via `outlineBounds`), mantendo só os pontos que passam no `pointInPolygon`, até 400 tentativas.
2. **Ordena por ângulo** (`atan2`) em torno do centróide dos pontos amostrados. É isso que impede o laço de se autocruzar: percorrer vértices em ordem angular ao redor de um ponto interior sempre traça um polígono simples.
3. Devolve `{ waypoints, center }`, com `center` sendo o centróide do laço — onde o ninho fica.

Recebe a função de random por parâmetro para ser determinístico em teste.

### Spawn: determinístico, um por região

`spawnTerritorial()` em `enemies.ts`, chamado do `initialize()` — que já roda **depois** do `worldStore.initialize()` nos dois caminhos (boot e regenerate), então as regiões existem. Para cada def com `behavior === "territorial"` e `habitat.kind === "biome"`, percorre `worldStore.regionsOfBiome(...)` e coloca **um** verme por região, guardando o `regionId`. Nada de rolagem probabilística: dois desertos, dois vermes.

É **idempotente** — pula regiões que já têm um verme daquele tipo, então chamar de novo não duplica.

### Comportamento (`updateEnemyAI`, branch `territorial`)

`territorialDestination(enemy, gameDeltaMs)`:

- **Patrulhando** (padrão): anda ao waypoint atual e avança o `patrolIndex` ao chegar a menos de 30 unidades, em laço. O ataque a quem se aproxima já vem do `hostileToAll` (seção 3) mais o auto-aggro do combat store — nenhuma lógica de ataque nova aqui.
- **Ferido e fora de combate**: marca `resting`, caminha até o `nestPosition` e regenera **2% da vida máxima por segundo de jogo** ali. Ao completar a vida, `resting` desliga e a patrulha **retoma do waypoint onde parou** (o `patrolIndex` é preservado).
- **Enfurecido**: `enraged` **suprime o descanso** — senão um ninho saqueado mandaria o verme para casa no meio da fúria. E o leash de desistência (`MAX_CHASE_DISTANCE`/`MAX_CHASE_TIME_MS`) passa a ser ignorado, então as unidades precisam lutar ou fugir de verdade.

Quem liga o `enraged` é o saque do ninho, na seção 6.

### Arquivos afetados

- `app/types/Resource.ts`: `Fat`, `LegendaryFang`, ícones, `Fat` em `FOOD_RESOURCE_TYPES`.
- `app/components/ResourcePanel.vue`: as quatro entradas faltantes.
- `app/data/actionDefinitions.json`: `swallow`.
- `app/data/enemyDefinitions.json`: def do verme (chave `sandWorm`), vindo do arquivo pendente, que foi **removido**.
- `app/types/Enemy.ts`: `SandWorm`, `"territorial"`, e os campos `regionId`/`patrolRoute`/`patrolIndex`/`nestPosition`/`resting`/`enraged`.
- `app/utils/patrol.ts` (novo): geração da rota.
- `app/stores/enemies.ts`: `spawnTerritorial`, `territorialDestination`, leash respeitando `enraged`.

---

## 6. Ninho: entidade, saque, escolha do jogador, respawn — IMPLEMENTADO

Mecânica **genérica**, não exclusiva do verme: qualquer def com `behavior: "territorial"` ganha nest automaticamente, sem nenhum código específico por espécie — hoje só existe `sandWorm`, mas um segundo inimigo territorial (outro bicho, outro bioma) herdaria o ninho só por ter esse `behavior` e um `nestLoot` no JSON.

### Store `app/stores/nests.ts`

```ts
interface Nest {
  id: string;
  regionId: string;       // qual BiomeRegion
  enemyType: EnemyType;    // qual def de inimigo territorial este ninho pertence
  position: Position;      // = nestPosition do guardião
  enemyId: string | null;  // id do guardião vivo atual, se houver
  state: "unclaimed" | "cooldown"; // "unclaimed" = saque disponível pra escolha
  respawnAtDay: number | null;     // quando volta a existir um guardião aqui
}
```

`enemyType` não estava no desenho original da interface — entrou porque `checkRespawns` precisa saber **qual** def territorial recriar na região; guardar a chave evita hardcode do tipo e é o que torna a store agnóstica de espécie.

- `initialize()`: um nest por inimigo territorial já existente na store de inimigos (chamado depois de `enemyStore.initialize()`, tanto no boot quanto no `regenerateWorld` do `World.vue`).
- `raid(nestId, choice: "eggs" | "loot" | "cancel")`:
  - `"eggs"`: `inventoryStore.addResource(Egg, 15-30)`; agenda respawn em `7 * 3 = 21` dias.
  - `"loot"`: rola o `nestLoot: LootDrop[]` novo do def do inimigo dono do nest (no verme: fat/whiteMeat/legendaryFang, separado do `lootTable` de combate); agenda respawn em `7` dias.
  - `"cancel"`: no-op.
  - Em qualquer escolha que não seja cancelar: se `enemyId` aponta pra um guardião ainda vivo, seta `enraged: true` nele.
- `checkRespawns(day)`: chamado do watcher de dia já existente (`app/stores/game.ts`). Reaproveita `enemies.ts`/`spawnTerritorialInRegion` (extraído de `spawnTerritorial`, que agora só faz o loop de regiões e delega a esta função) passando o `nest.position` original como `pinnedNestPosition` — a rota de patrulha é nova, mas o ninho fica sempre no mesmo lugar, como o plano original pedia.

### UI: escolha ao clicar no ninho

`app/components/World.vue`: ninho renderizado com `drawIconSync` (não `drawEntityIconSync` — o nest não é `Structure`/`Unit`/`Resource`/`Enemy`, só uma posição + estado), ícone `nest-eggs` normalmente (ninho cheio, disponível pra saque), `crow-nest` em `cooldown` (ninho vazio), tamanho fixo em unidades de mundo (`NEST_ICON_SIZE = 40`, escala com o zoom como qualquer entidade — ao contrário do marcador de fome, que é fixo na tela). Clique nele (mesmo padrão de hit-test circular já usado pra unidade/estrutura/recurso) abre `app/components/NestRaidModal.vue` (`UModal`, tema mono/verde igual ao `StructurePanel`/`ResourcePanel`): título mostra o `label` do def do dono do nest (hoje sempre "Verme de Areia", mas dinâmico), 3 botões — Coletar ovos / Manter e saquear / Cancelar — chamando `nestStore.raid(...)`. Em `cooldown` o modal só mostra "respawna no dia X".

### Arquivos afetados

- `app/stores/nests.ts` (novo).
- `app/stores/enemies.ts`: `spawnTerritorialInRegion` extraído de `spawnTerritorial`, exposto pra store de nests reusar no respawn.
- `app/types/Resource.ts`: `ResourceType.Egg`, ícone `egg-clutch`, entrou em `FOOD_RESOURCE_TYPES`.
- `app/components/ResourcePanel.vue`: cor/nome do ovo (senão quebra o `Record<ResourceType, string>`, mesma armadilha da seção 5).
- `app/utils/iconRenderer.ts`: `NEST_ICONS` (mesmo padrão do `STATUS_ICONS`), preload.
- `app/data/enemyDefinitions.json`: `nestLoot` no `sandWorm`.
- `app/components/World.vue`: render do ninho, cursor de hover, hit-test de clique, `nestStore.initialize()` no boot e no `regenerateWorld`.
- `app/components/NestRaidModal.vue` (novo).
- `app/stores/game.ts`: `nestStore.checkRespawns(day)` no watcher de dia já existente.

---

## 7. Fauna passiva (capivara) — IMPLEMENTADO

**Correção de rota:** a primeira versão saiu errada. Eu li "unidade passiva" como *unidade do jogador* e fiz a capivara reproduzível no forte. Ela é **fauna selvagem** — spawna pelo mapa como lobo ou verme, nunca luta, e existe para ser **caçada pelo loot**. É a base para qualquer animal pacífico futuro.

### O traço `passive` vive em `Enemy`

```ts
/** Wildlife that never fights: acquires no target, and bolts when hit instead of retaliating. */
passive?: boolean;
fleeing?: boolean;
```

Duas peças fazem isso funcionar:

- **Nunca engaja.** `updateCombat` pula o `processCombatant` para passivos. Isso não é redundante com "não ter ações": sem o skip, o animal **adquiriria alvo** pelo `findEnemyTarget` e o `updateEnemyAI` o faria **perseguir** a unidade, sem nunca atacar (o `pickAction` devolveria null). Um animal pacífico seguindo o jogador pelo mapa.
- **Foge ao ser atingido.** `reactToHit` ramifica: unidade armada revida, animal passivo corre, o resto absorve. Como todos os caminhos de dano passam por essa função, o animal também foge do **splash de AOE** e da **investida do mamute**, não só de golpes diretos.

`fleeFrom` manda o animal 260 unidades na direção oposta, com destino clampado à margem do mapa. No `updateEnemyAI`, fugir tem **prioridade sobre a vagueação ambient**, e o `fleeing` se limpa na chegada.

### A capivara

`behavior: "ambient"`, habitat `grassland`, em grupos de 2 a 4 (`packBiome` + `packSizeRange`), cap 8. Velocidade 2,2 em terra e **3,4 na água** — nada melhor do que anda, que é o traço real do bicho. 60 de vida, `attack: 0`, `actionIds: []`, então o alcance derivado (seção 10) dá 0.

Loot: carne 4–9 garantida e couro 2–4 a 80%. Generoso de propósito: grassland é onde o jogador começa, então a capivara é a **primeira fonte de carne acessível** — e com as carcaças da seção 3b, caçar é ir buscar.

### O que foi desfeito

`UnitType.Capybara`, o def em `unitDefinitions.json`, a entrada no `canReproduce` do forte, e `Unit.passive`/`Unit.fleeing`. O traço não faz sentido em unidade do jogador hoje: worker e miner são desarmados mas **não** passivos, e continuam absorvendo dano sem fugir — o teste cobre essa distinção.

### Cor no mapa

Fauna pacífica **não é desenhada em vermelho**. `ENTITY_COLORS` ganhou `wildlife` (`#c08552`, marrom), e `getEntityColor` escolhe por `entity.passive` — vermelho segue reservado para o que ataca. O `preloadAllIcons` usa a mesma regra por def, senão o ícone da fauna nunca entraria no cache com a cor certa e cairia no caminho lento.

`getEntityColor` e `ENTITY_COLORS` passaram a ser exportados, para o painel de unidades (seção 17) e tooltips futuros usarem as mesmas cores do mapa em vez de redefini-las.

### Arquivos afetados

- `app/types/Enemy.ts`: `EnemyType.Capybara`, `passive`, `fleeing`.
- `app/utils/iconRenderer.ts`: cor de fauna, `getEntityColor` exportado.
- `app/data/enemyDefinitions.json`: a capivara.
- `app/stores/combat.ts`: `reactToHit` + `fleeFrom`; passivo pulado no `updateCombat`.
- `app/stores/enemies.ts`: fuga com prioridade no `updateEnemyAI`.
- `app/utils/iconRenderer.ts`, `app/components/World.vue`: marcador de fuga em inimigos.

---

## 8. Spawn de inimigos: taxa e cap por região de bioma — PLANEJADO

Mantém a cadência **horária** que já existe, e troca o teto global por um teto **por região**.

### Como funciona hoje

- `game.ts` roda um check a cada hora de jogo (`AMBIENT_CHECK_INTERVAL_MS`) com 35% de chance fixa (`AMBIENT_SPAWN_CHANCE`) para **todos** os tipos de uma vez.
- `spawnAmbient` em `enemies.ts` percorre cada tipo ambient e para no `ambientCap` do def, que é um **teto global por tipo** no mapa inteiro (default 4).
- Resultado: a raridade de cada bicho não é configurável (todos dividem os mesmos 35%), e um mapa com 2 desertos tem exatamente o mesmo número de diabos de poeira que um mapa com 1.

### Como deve funcionar

Dois campos novos por def em `enemyDefinitions.json`:

- **`spawnRate`** — um número único que já **é** a raridade: a chance, por hora de jogo e por região do habitat, de nascer um indivíduo ali. Valor baixo = raro. Substitui o `AMBIENT_SPAWN_CHANCE` global de 0,35, que passa a não existir.
- **`biomeCap`** — teto **por região**, não do mapa.

O ciclo passa a ser: a cada hora de jogo, para cada região que casa com o `habitat` do bicho, rola `spawnRate`; se passar, nasce um, desde que a região ainda não tenha chegado no `biomeCap`.

Exemplo com `spawnRate: 0.25` e `biomeCap: 3` num mapa com **2 desertos**: cada deserto rola 25% por hora, então em ~12 horas de jogo cada um tende a encher os 3 e para. O mapa comporta **até 6**. Com 1 deserto, comporta 3 — o teto escala com a geografia gerada, que é o ponto.

Um bicho raro fica `spawnRate: 0.03`; um bicho comum, `spawnRate: 0.5`. Não há campo de quantidade separado: a quantidade emerge da taxa somada ao cap.

### Dependências e pontos de atenção

- **Depende da seção 4** (`id` em `BiomeRegion`, `biomeRegions` exposto e a contagem por bioma). Sem identidade estável de região não há como contar "quantos já existem nesta região".
- **Contagem por região precisa de um teste de pertencimento.** Duas opções: guardar `regionId` no `Enemy` no momento do spawn (barato, mas fica errado assim que o bicho anda para fora), ou contar por `pointInPolygon(enemy.position, region.outline)` na hora de rolar (sempre correto e roda 1x por hora, custo irrelevante). **Recomendo o segundo.**
- **Habitats que não são bioma.** O lobo usa `habitat: {kind:"resource", resourceType:"wood"}` e a piranha `{kind:"lake"}`. A generalização natural é o cap ser **por instância do habitat**: por região de bioma para `kind:"biome"`, por lago para `kind:"lake"`. Para `kind:"resource"` não há instância óbvia — decisão aberta.
- **O `ambientCap` global sai de cena**, substituído pelo `biomeCap`. O `packBiome`/`packSizeRange` do lobo continua fazendo sentido como "nasce em grupo", e é ortogonal ao `spawnRate` — vale checar na hora se dá para unificar.
- **Onde fica o gatilho:** continua no `updateGame` de `game.ts`, no mesmo `AMBIENT_CHECK_INTERVAL_MS` de hoje. O que muda é que a rolagem passa a ser por tipo **e** por região, em vez de uma rolagem global.

### Decisões abertas

- **Cap para habitat de lago e de recurso:** por lago resolve a piranha. Para o lobo (habitat `resource`), o cap volta a ser global por tipo, ou passa a ser por região de bioma da posição sorteada?
- **Números por bicho:** `spawnRate` e `biomeCap` de cada um dos 7 inimigos.

---

## 9. Performance — A–D1 + correções de `isInWater` IMPLEMENTADOS

O loop rodava tudo a 60fps sobre stores profundamente reativas, sem culling no render.

### A. `drawEntityIcon` async no render loop — FEITO

`render()` chamava `void drawEntityIcon(...)` para **cada** recurso, estrutura, inimigo e unidade, e a função é `async` — cada chamada alocava uma Promise e um microtask mesmo com o ícone já em cache. Com ~35 recursos mais dezenas de entidades a 60fps, eram milhares de Promises por segundo, pressão de GC e ordem de desenho não determinística.

`drawEntityIconSync` já existia em `iconRenderer.ts` e não era usado em lugar nenhum. Agora é, nos quatro laços. O `drawEntityIcon` async não é mais importado pelo `World.vue`.

### B. Culling de viewport — FEITO

Nenhum laço testava visibilidade: com zoom-in, a maioria dos `drawImage` era descartada pelo canvas depois de já ter custado. A matemática saiu para **`app/utils/viewport.ts`** novo, puro e testável:

- `viewportBounds(canvasWidth, canvasHeight, zoom, panX, panY)` — o retângulo de mundo visível.
- `circleOnScreen(x, y, radius, view)` — usa o raio do ícone, então um ícone metade fora da tela ainda desenha (nada de pop-in na borda).
- `boundsOnScreen(bounds, view)` e `outlineBounds(outline)` — para os polígonos de água.

O `drawGrid` passou a receber esse mesmo `view` em vez de recalcular a conta por conta própria, então as duas não podem divergir.

### C. Água re-renderizada por frame — FEITO (por caminho diferente do planejado)

`drawTerrain` chamava `createRadialGradient` **por lago, por frame**, e desenhava todos os lagos e rios sem culling.

O plano original era assar a água numa textura offscreen como o `buildBiomeTexture` faz. **Não foi por aí:** o `drawWaterPolygon` usa `3 / camera.zoom` e `8 / camera.zoom` nas espessuras de borda, de propósito, para a borda ter espessura constante na tela. Assar isso numa textura de mundo mudaria o visual conforme o zoom.

Em vez disso: um `waterCache` guarda os gradientes dos lagos e os bounds de lagos e rios, reconstruído só quando os arrays da world store trocam de referência (ou seja, na geração do mundo). O desenho segue por frame, com culling, e o visual fica idêntico — mesmo ganho principal, zero risco visual.

### D1. Arrays de store lidos uma vez por frame — FEITO

`allUnits`/`mapUnits`/`allEnemies`/`allResources` são computeds que fazem `Array.from(map.values())` e são invalidados por qualquer mutação de posição — ou seja, **reconstruídos a cada frame**. E eram lidos várias vezes por frame: `render()` percorria recursos, estruturas e inimigos duas vezes cada (ícones, depois halos), e `updateCombat` lia `mapUnits` e `allEnemies` três vezes cada.

Agora ambos tiram um snapshot no início e trabalham sobre ele. Efeito colateral bom: os laços de remoção do `updateCombat` mutam os Maps enquanto iteram, o que agora acontece sobre um snapshot em vez do computed vivo. Os laços de halo também ganharam um guard de `size > 0` para não percorrer nada quando não há seleção.

### E o que o profile mostrou: o gargalo era outro

Medido no jogo rodando (dev server, stores acessadas pelo hook do Vue devtools, `performance.now()` em volta de cada sistema). **Meu palpite estava errado** — eu tinha apostado em render e na reatividade das entidades. O gargalo real era `isInWater`.

`updateEnemyAI` chamava `isInWater` por inimigo por frame, contra 11 corpos d'água com outlines de 58 a 96 vértices. E `lakes`/`rivers` eram `ref<Lake[]>`, ou seja **profundamente reativos**: cada acesso a `outline[i].x` dentro do point-in-polygon passava por um proxy do Vue. Medido: a mesma função sobre a mesma água em objetos planos custava **11x menos** (1,29ms vs 14,23ms para 100 inimigos). Isso era ~74% do `updateEnemyAI`.

Somado a isso, o descarte inicial usava `radius`, e um rio tem `radius` do tamanho do seu comprimento (medidos: 1364 e 1810 num mapa de 5000) — então o círculo praticamente não rejeitava nada e quase todo inimigo caía no teste de polígono.

**Duas correções:**

1. **`lakes`/`rivers` viraram `shallowRef`** em `world.ts`. Os arrays só são substituídos inteiros na geração, então shallow é também o correto semanticamente. `updateEnemyAI` com 100 inimigos: **19,18ms → 8,51ms**, medido no mesmo mundo.
2. **`bounds` pré-computado no `Lake`** (`outlineBounds` na geração), e `isInWater` rejeita pela caixa antes de tocar em vértice. `updateEnemyAI`: **8,51ms → 1,42ms**. Validado com 29.434 pontos comparando com a versão antiga: **zero divergências**.

`Bounds`/`outlineBounds` passaram a viver em `utils/geometry.ts` (é geometria pura); `utils/viewport.ts` reexporta.

### Ganho medido no frame de simulação

Soma de `updateUnitPositions` + `updateFortUnits` + `updateEnemyAI` + `updateCombat` + `decayCarcasses`, em ms por frame:

| Inimigos | Antes | Depois | % do budget de 16,67ms (antes → depois) |
| -------- | ----- | ------ | --------------------------------------- |
| 0        | 0,27  | 0,28   | 2% → 2%                                 |
| 40       | 6,48  | 1,55   | 39% → 9%                                |
| 60       | 11,35 | 2,11   | 68% → 13%                               |
| 100      | 18,36 | 4,17   | **110% → 25%**                          |
| 200      | 38,92 | 6,82   | **233% → 41%**                          |
| 400      | —     | 14,52  | — → 87%                                 |

Com 100 inimigos a simulação **estourava sozinha** o frame de 60fps, antes de qualquer render. Ressalva honesta: o salto do passo 1 foi medido no mesmo mundo; o do passo 2 em mundo regenerado (10 corpos d'água em vez de 11), então há algum ruído de geometria — mas a ordem de magnitude é inequívoca.

### Grade de ocupação de água — protótipo validado, não implementado

Ideia do Pedro: como rios e lagos nunca mudam, cachear pesado. Prototipei no browser uma **grade de 3 estados** (seco / água / borda), célula de 32px: célula de borda cai no teste exato, as outras respondem por indexação de array.

Resultado: 24KB de memória, 47ms para construir uma vez, `isInWater` **6,8x mais rápido** (0,421ms → 0,062ms para 400 posições), e **zero divergências em 148.225 pontos** contra o exato.

**Não implementei, de propósito:** depois das duas correções acima, `isInWater` custa 0,42ms de um frame de 22,76ms com 400 inimigos — **1,8%**. A grade economizaria ~1,6% do frame. A ideia é correta e o protótipo está validado; vale guardar para quando a água voltar a aparecer no profile (por exemplo se as unidades passarem a consultá-la com muito mais frequência), não agora.

### O travamento no movimento de câmera: era o compositor, não o JS

Queixa do Pedro: travava ao mover a câmera. O profile de JS não explicava — com 0 inimigos, `render()` emitia comandos em ~1,4ms e o pan custava 0,002ms. Medido com a aba **em primeiro plano** (obrigatório: em background o Chrome não rasteriza, então o custo de pintura é invisível):

| Cenário | fps | ms/frame | frames > 20ms |
| ------- | --- | -------- | ------------- |
| baseline | 36,6 | 27,3 | 57 de 100 |
| metade da resolução | **60,0** | 16,7 | **0** |
| um quarto da resolução | 60,0 | 16,7 | 0 |

O JS de render ficou em ~1ms nos três. **Cortar pixels resolvia; cortar trabalho de JS não.** Ou seja, o jogo era limitado por rasterização/composição, não por CPU — com ~90% do frame gasto fora do JavaScript.

A GPU está ativa (`ANGLE (Intel, Mesa Intel HD Graphics 620)`), então não era fallback de software. Duas causas, ambas na composição:

1. **O canvas era criado com canal alfa.** `getContext("2d")` traz `alpha: true` por padrão, o que faz o compositor blendar a camada inteira do canvas (1,9M px) contra o fundo da página a cada frame. Como o `render()` sempre pinta um `fillRect` de fundo opaco, o alfa nunca era usado para nada. Passou a ser **`getContext("2d", { alpha: false })`**.
2. **`backdrop-filter: blur(8px)` em cinco HUDs** sobre o canvas. `backdrop-filter` re-borra a região a cada frame em que o conteúdo atrás muda — e o canvas muda todo frame. Medido isoladamente: remover os blurs levou de 41,1 para 48,3 fps e cortou os frames longos pela metade. Trocados por `bg-black/90` opaco (visual quase idêntico, o fundo já era escuro). O único que sobrou é o overlay de "O Forte Caiu", que é estático e some junto com o jogo.

**Resultado no caso relatado: 36,6 fps → 60 fps travado, zero frames acima de 20ms.**

Lição para a próxima vez: medir JS não é medir frame. Um profile de CPU limpo com FPS ruim é assinatura de fill-rate/compositing, e a checagem barata é reduzir `canvas.width/height` pela metade — se o FPS salta, o gargalo é pintura.

### Onde o gargalo está agora

Com câmera parada ou em movimento e poucos inimigos, o jogo trava em 60fps. Sob carga alta de inimigos ele ainda cai — e **não é JS de render** (medido em 1,75ms com 300 inimigos):

| Inimigos | fps | ms/frame | frames > 20ms | JS de render |
| -------- | --- | -------- | ------------- | ------------ |
| 0        | 60,0 | 16,7 | 0 | 1,31ms |
| 100      | 49,5 | 20,2 | 31 de 150 | 1,44ms |
| 300      | 26,6 | 37,6 | 147 de 150 | 1,75ms |

Sobra a simulação mais a rasterização dos ícones extras. Do lado da simulação, `updateCombat` domina:

| Inimigos | `updateCombat` | `updateEnemyAI` | `updateUnitPositions` |
| -------- | -------------- | --------------- | --------------------- |
| 100      | 2,83ms         | 1,50ms          | 0,02ms                |
| 400      | **14,57ms**    | 5,80ms          | 0,02ms                |

Escala levemente superlinear (4x de inimigos → 5,1x de custo). Os suspeitos, na ordem:

- **`rebuild` dos dois SpatialGrids por frame** (item F acima) — limpa e reinsere tudo, alocando arrays de célula. Agora vale medir, ao contrário do que eu disse antes.
- **`processCombatant` por entidade** — `tickCooldowns` percorre `Object.keys(actionCooldowns)` por entidade por frame, e `findEnemyTarget` faz consulta ao grid por inimigo.
- **Mutação das posições** (D2): medido em 1,64ms por frame para 400 inimigos. Real, mas não dominante — a reatividade de entidade custa bem menos que a da geometria do mundo custava.

Itens **E** (alocação em `updateUnitPositions`) e **G** (efeitos no DOM) seguem sem evidência de que importam: `updateUnitPositions` mede 0,02ms.

### Como reproduzir a medição

Com o dev server no ar, no console da página:

```js
const hook = window.__VUE_DEVTOOLS_GLOBAL_HOOK__;
const pinia = hook.apps.find((a) => a?.config?.globalProperties?.$pinia).config.globalProperties.$pinia;
const s = {}; for (const [id, store] of pinia._s) s[id] = store;
s.time.setSpeed(0);                                   // congela o loop para não competir
s.enemies.initialize();
while (s.enemies.allEnemies.length < 100) s.enemies.spawnHorde(20);
// então cronometrar s.enemies.updateEnemyAI(16.67), s.combat.updateCombat(16.67), etc.
```

**O render (itens A–C) não foi medido.** `requestAnimationFrame` não roda em aba de background, e a medição foi feita com a aba sem foco — o que aliás significa que os updates também não rodavam sozinhos, por isso deu para cronometrá-los limpo. Medir render exige a aba em primeiro plano.

## 10. Alcance derivado das ações — IMPLEMENTADO

`combatRange` vivia na **entidade** e respondia por duas coisas: o raio de **aquisição de alvo** e a **aproximação** ao perseguir. `minRange`/`maxRange` vivem na **ação**, e o `pickAction` filtra por eles. O defeito: os dois tinham que concordar e ninguém garantia isso.

**Agora `combatRange` é derivado**: `combatRangeFor(actionIds, ACTION_DEFS)` em `utils/combatEngine.ts` devolve o maior `maxRange` entre as ações, ou 0 quando desarmado. Chamado no `createEnemy` e no `spawnUnit`; o campo **saiu dos dois JSONs** (13 defs de inimigo, 3 de unidade).

Efeito nas seis divergências:

| def | antes | agora |
| --- | ----- | ----- |
| dustDevil | 50 | **200** — o raio maligno finalmente é usado à distância |
| mammoth | 55 | **260** — sem isso a investida nunca dispararia |
| bear | 45 | 55 |
| tiger | 43 | 55 |
| hunter | 200 | 260 |
| parasaurolophus | 60 | **40** — parava fora do próprio alcance e flailava |
| toadTeeth | 40 | **35** — idem |

O verme não mudou: era 70 declarado, é 70 derivado (`maul` 45, `swallow` 70).

Não implementei o override opcional — nenhum def precisou dele. Se um dia fizer sentido "engaja mais perto do que alcança", vale um campo com **nome diferente** (`engageRange`), para não reintroduzir a ambiguidade que o `combatRange` tinha.

---

## 11. Ataques novos: charge, poisonSting, evilMagicRay — IMPLEMENTADO

**Depende da seção 10** e isso não era opcional: com o `combatRange` declarado, o mamute engajava a 55 e a investida (`maxRange` 260) nunca disparava. Descobri isso pelo teste, não por leitura.

### evilMagicRay

Ranged, `2d6` com scaling 60%, cooldown 1800ms, `maxRange` 200. `ActionVfx` ganhou `"magicRay"` e o `CombatEffects.vue` o estilo: gradiente roxo com `box-shadow` de glow, e a animação **cresce em largura** em vez de transladar — um raio aparece inteiro, não viaja como flecha.

### poisonSting

`1d3` com scaling 20% (dano ~2) mais `poison: { durationMs: 6000, damagePerSecond: 3 }` — o veneno é o ataque, não o golpe.

Campos novos: `ActionDefinition.poison` e `Combatant.poison` (`{ remainingMs, damagePerSecond }`). Reaplicar **refresca o timer e mantém o tick mais forte**, em vez de empilhar sem limite.

O tick roda em **laço próprio no `updateCombat`**, antes do combate. Isso era a armadilha anotada no plano e ela é real: `processCombatant` só é chamado para unidades com `actionIds.length > 0`, então um worker envenenado nunca tomaria dano. O teste cobre exatamente esse caso.

Marcador de status verde (ícone `poison`) no canto superior-**esquerdo** de unidades e inimigos, reusando `STATUS_ICONS`/`drawIconSync`. O `drawStarvingMarker` virou `drawStatusMarker(entity, icon, corner)`, genérico — fome fica na direita, veneno na esquerda, e os dois aparecem juntos sem sobrepor.

### charge

`3d8` com scaling 80%, `minRange` 80, `maxRange` 260, cooldown 4200ms, `charge: { radius: 70, pushDistance: 90 }`.

1. **Avanço**: `advanceCharge` no `combat.ts` (não no `updateEnemyAI`, que faz `continue` quando há `actionLock`) cobre `gap * (delta / msRestantes)` por frame, convergindo no `impactMs` mesmo com o alvo em movimento.
2. **Varredura em cápsula**: o `ActionLock` ganhou `origin`, e `sweepCharge` mede `distanceToSegment(vítima, origin, posiçãoAtual)` contra o `radius`. Consulta os grids por um círculo no ponto médio da linha, então não varre o mapa.
3. **Dano em hostis, empurrão em todos** — um rebanho de mamutes atravessa os seus sem fogo amigo. O empurrão é perpendicular à linha, virado para o lado onde a vítima já está.

#### Empurrão ao longo do tempo, não em salto

A primeira versão mutava a posição no instante do impacto: 90 unidades de uma vez, o que **lia como teleporte**, não como empurrão. Agora o empurrão é estado:

```ts
knockback?: { dirX: number; dirY: number; peakSpeed: number; remainingMs: number; totalMs: number };
```

`shoveFromLine` apenas **agenda**; `tickKnockback` desloca ao longo de 320ms, no mesmo passe do veneno (que já cobre todas as unidades e inimigos, inclusive os desarmados). A velocidade de pico decai linearmente até zero, e a integral disso ao longo da duração é **exatamente** `pushDistance` — o empurrão chega onde chegava antes, mas com desaceleração visível. A posição é clampada ao mapa a cada tick.

Medido no teste: 7 ticks de 50ms para completar, e a distância à linha da investida sai de 20 para 124.

#### O vfx mostra a hitbox

Um `chargeSweep` novo desenha **a cápsula exata** que o dano varre: um retângulo da origem até a posição final, meia-largura igual ao `radius`, pontas arredondadas (`border-radius: 9999px`), em âmbar translúcido com borda. Como o dano usa `distanceToSegment` contra o mesmo `radius`, o que aparece na tela é literalmente a área afetada — não uma aproximação decorativa.

`EffectSpec` ganhou `radius?: number` para isso, e o `fxStyle` o expõe como `--radius`.

A geometria foi **medida no browser**, porque `calc()` com margem negativa e `transform-origin` é fácil de errar: varredura horizontal de 200px com raio 70 deu um elemento de 340×140 com `margin -70px` e `transform-origin: 70px 70px`; uma diagonal de (120,160) com raio 40 deu 280×80 e `matrix(0.6, 0.8, -0.8, 0.6)`, que é rotação de 53,13° — o ângulo correto.

**Bug que o teste pegou:** o standoff da investida era `combatRange * 0.6`. Como o `combatRange` agora vem do `maxRange` desta mesma ação (260), o standoff dava 156 — maior que a distância de muitos alvos, e o mamute concluía que já havia chegado sem andar um pixel. Passou a ser `charge.radius * 0.5`, que é o alcance de contato e não o da corrida.

### Também entrou

- **`ResourceType.Poison`** com ícone `poison-bottle` — o loot do escorpião já o referenciava e caía como chave inválida.
- **`mammoth`, `parasaurolophus`, `velociraptor`, `scorpion`, `toadTeeth` no `EnemyType`.** O `spawnAmbient` itera esse enum, então sem isso nenhum deles spawnava — e as ações novas não teriam quem as usasse.

---

## 12. Sistema de construção — PLANEJADO (base de 13, 14 e 15)

Hoje só existe o `fort`, criado no `initialize`. Nada é construído em jogo.

### Modelo

`structureDefinitions.json` ganha por def:

```jsonc
"house": {
  "buildCost": { "wood": 40, "stone": 20 },
  "buildTimeHours": 6,          // escalado pela eficiência de quem constrói
  "category": "housing",         // agrupa no menu de construção
  "housing": 4                   // ver seção 14
}
```

`Structure` ganha estado de obra:

```ts
construction?: {
  /** O que ainda falta ser entregue no canteiro. */
  pending: Partial<Record<ResourceType, number>>;
  /** Progresso de 0 a 1, avançado por quem está trabalhando na obra. */
  progress: number;
};
```

Uma estrutura com `construction` desenha como canteiro, não funciona (não abriga, não estoca, não crafta) e tem vida reduzida.

### Fluxo

1. Jogador escolhe no **menu de construção** e clica no mapa → nasce o canteiro com `pending` = custo cheio.
2. Trabalhadores **buscam os recursos onde eles estão** e os levam ao canteiro. Isso exige `Unit.hauling?: { type: ResourceType; amount: number; toStructureId: string }` e um estado de transporte novo.
3. Com o `pending` zerado, quem estiver no canteiro avança `progress` a uma taxa proporcional à **eficiência**, do mesmo jeito que a coleta já faz (`unit.efficiency / gatherTime`).

Reusa bastante do que existe: o pipeline de "andar até um ponto e acumular progresso" do gather, o hit-test de clique do `World.vue`, o spatial grid para achar a origem mais próxima, e o `ActionBar` para o comando.

### O estoque tem posição física (decidido)

**Todo item está sempre no inventário de alguém** — de uma unidade ou de uma estrutura. Não existe mais um pote global abstrato. O `inventoryStore` de hoje, um `Map` global, deixa de ser a fonte da verdade e passa a ser uma **visão agregada**: a soma dos inventários locais, para a UI continuar mostrando "quanto tenho no total".

Consequências, e nenhuma é pequena:

- **Coletar deixa de creditar direto.** Hoje `updateUnitPositions` faz `inventoryStore.addResource(collected, 1)` no instante da coleta. Passa a depositar no inventário **da unidade**, que tem capacidade — e a unidade precisa **entregar** num armazém quando lotar. Esse é o mesmo transporte que a construção usa, então vale construir um só.
- **Gastar recurso deixa de ser instantâneo.** Construir, reproduzir e craftar hoje debitam um número global. Passam a exigir que o recurso **exista em algum lugar** e seja levado até onde é consumido.
- **Roteamento.** Um trabalhador que precisa de 40 de madeira tem de escolher de qual depósito tirar. O `SpatialGrid` já resolve "o mais próximo"; o que não é trivial é quando nenhum depósito sozinho tem o suficiente e a carga precisa vir de dois.
- **A conversão em prestígio (seção 16)** passa a somar os inventários locais, e vale decidir se o que estava carregado por uma unidade morta conta.

Isso encarece a seção 12 de forma significativa, mas é a decisão do jogo: logística é gameplay, não contabilidade.

### Estruturas propostas

| Estrutura | Categoria | Serve para |
| --------- | --------- | ---------- |
| Casa | housing | Aumenta o teto de população (seção 14) |
| Armazém | storage | Aumenta o teto de inventário (seção 13) |
| Fazenda | production | Comida sem depender de coleta no mapa |
| Muralha | defense | Bloqueio; exige colisão, que o jogo **não tem** hoje |
| Forja | crafting | Fabrica equipamento (seção 15) |

**A muralha depende da seção 20 (pathfinding)** e não deve ser tentada antes: unidades e inimigos hoje andam em linha reta atravessando tudo. As outras quatro estruturas não bloqueiam passagem e podem vir antes.

---

## 13. Limite de inventário por estrutura — PLANEJADO (depende de 12)

`inventoryStore` hoje não tem teto: `addResource` sempre aceita.

- `structureDefinitions.json` ganha `storage: number` (forte e armazém).
- `inventoryStore.capacity` = soma de `storage` das estruturas **prontas** (canteiro não conta).
- `addResource` passa a respeitar o teto.

**Decisão aberta — o que acontece ao encher?** As opções mudam o feel: a coleta para sozinha (menos frustrante, mas exige feedback claro de por que os workers pararam), o excedente é descartado (simples e cruel), ou o recurso fica no chão como carcaça (reusa a seção 3b inteira, e é o mais interessante).

Outra: o teto é **global** ou **por tipo de recurso**? Global é mais simples; por tipo obriga a planejar espaço.

---

## 14. Teto de população — PLANEJADO (depende de 12)

Cuidado com um nome já ocupado: **`maxOccupancy: 10` já existe** no forte, mas significa *quantos caibam dentro do abrigo* — é usado por `structureOccupancy` e `shelterUnitsAt`. O que falta é diferente: **quantas unidades o jogador pode ter no total**. Usar o mesmo campo para as duas coisas vai confundir; sugiro **`housing`** para o novo.

- `populationCap` = soma de `housing` das estruturas prontas. Forte dá 10; cada casa soma.
- `startReproduction` (`app/stores/units.ts`) passa a recusar quando `allUnits.length >= populationCap`. É o ponto único por onde unidade nova entra no jogo, então basta ali.
- O `UnitsTab.vue` já mostra `inFort.length / maxOccupancy`; ganha uma linha de população total, e o botão de reproduzir desabilita com o motivo visível ("sem moradia").

Sem teto máximo: casas somam indefinidamente. Vale lembrar que o custo real de população alta é a comida (seção 2) e a performance (seção 9).

---

## 15. Inventário e equipamento das unidades — PLANEJADO (depende de 12)

### Carga

`Unit.inventory?: Array<{ type: ResourceType; amount: number } | null>` — slots de tamanho fixo com stacks. Hoje a coleta entrega direto ao inventário global; com carga, a unidade acumula até lotar e então precisa **entregar** num armazém, o que reusa o mesmo transporte da seção 12.

Isso muda o loop de coleta de forma sensível: hoje coletar é instantâneo do ponto de vista logístico. Vale decidir se a carga é obrigatória (mais RTS, mais micro) ou se a entrega é automática à distância.

### Equipamento

`Unit.equipment?: Partial<Record<EquipmentSlot, ItemId>>` com slots `weapon`, `armor`, `clothing`, `trinket`. Itens modificam status ou dão efeitos.

**Aqui há um pré-requisito estrutural.** O jogo já separa base e efetivo em `baseSpeed`/`speed` e `baseEfficiency`/`efficiency` — exatamente o par que equipamento precisa. Mas **`attack` e `defense` não têm esse par**: são valores únicos copiados do def. Equipar uma arma exigiria criar `baseAttack`/`baseDefense` e recalcular o efetivo, senão o bônus se perde ou se acumula errado a cada troca.

Definições novas em `app/data/itemDefinitions.json`: slot, modificadores, receita (`craftCost` + `craftTimeHours`) e qual estrutura fabrica. A forja consome recursos e tempo, no mesmo padrão da obra.

### Decisões abertas

- Quantos slots de carga, e o tamanho do stack.
- Equipamento é por unidade (perde ao morrer) ou volta ao armazém?
- Itens têm durabilidade?

---

## 16. Pontuação, prestígio e rogue-lite — PLANEJADO

Store nova `app/stores/prestige.ts`, **persistente entre partidas** (localStorage) — é o único estado do jogo que sobrevive à morte.

### Ganhar pontos durante a partida

| Evento | Onde engatar |
| ------ | ------------ |
| Derrotar inimigo | `updateCombat`, onde `dropCarcass` já é chamado na morte |
| Saquear ninho | `nests.raid` (o seu trabalho de casa) |
| Sobreviver a uma noite | o watcher de fase do `game.ts` já detecta `dusk -> night`; a virada `night -> dawn` é o par natural |

Valor por inimigo provavelmente deve escalar com o quanto ele é perigoso — `maxHealth` e `attack` já dão uma base razoável, em vez de uma tabela à mão.

### Converter recursos na morte

Ao cair o forte (`gameStore.gameOver`, que já existe), todo o inventário vira prestígio por faixa:

| Pontos | Faixa | Tipos atuais |
| ------ | ----- | ------------ |
| 1 | comida | fish, mushroom, cactus, meat, whiteMeat, algae, fat |
| 2 | simples | wood, stone, leather |
| 4 | complexo | poison |
| 5 | superior | gold, legendaryFang |

Isso pede um `RESOURCE_SCORE_TIER: Record<ResourceType, number>` em `app/types/Resource.ts`, ao lado de `RESOURCE_ICONS` e `FOOD_RESOURCE_TYPES` — mesmo padrão, e o TypeScript passa a exigir uma faixa para todo recurso novo, o que evita esquecer.

**`metal` ficou sem faixa de propósito**: não foi citado, e cabe em "simples" (2, junto de madeira e pedra) ou "complexo" (4, por exigir minerador). Decisão sua.

### Gastar

Entre partidas, prestígio compra unidades iniciais extras, estruturas já construídas no começo, ou bônus permanentes. Isso exige uma **tela de meta-progressão** fora da partida, que o jogo não tem — hoje ele começa direto no mapa. É a maior peça desta seção, e provavelmente vale ser seu próprio item.

---

## 17. Painel de unidades — PLANEJADO

Lista todas as unidades do jogador, o que cada uma está fazendo, e permite pular a câmera até ela.

O "o que está fazendo" é **derivável do estado que já existe**, sem campo novo: `insideFortId` → no forte (com `reproductionProgress` → reproduzindo), `combatTargetId` → em combate, `targetResource` → coletando, `fleeing` → fugindo, `shelterTargetId` → indo se abrigar, `targetPosition` → em movimento, e nada disso → parada.

Reusa `camera.centerOn(x, y)`, que já existe (o botão `> FORT` usa), e o `selectionStore`. "Passar para um semelhante" é ciclar a lista filtrada por tipo, guardando o índice atual.

Vale mostrar também os marcadores de status que já existem (fome, veneno, fuga) — o painel é onde se percebe "três workers famintos" sem varrer o mapa.

---

## 18. Ctrl+clique para somar à seleção — IMPLEMENTADO

Como previsto, quase tudo já existia: `selectUnit` sempre foi acumulativo, e era o `selectUnits` (que limpa antes) que o clique usava.

O `selectionStore` ganhou duas operações, mantendo a semântica de seleção dentro do store em vez de espalhá-la pelo componente:

- **`addUnits(ids)`** — soma sem derrubar a seleção atual (Ctrl+arraste).
- **`toggleUnit(id)`** — pega se não está, solta se está (Ctrl+clique). Alternar é o comportamento esperado, e é o que permite tirar uma unidade de um grupo grande sem refazer a seleção.

No `World.vue`, `const additive = e.ctrlKey || e.metaKey` decide quatro caminhos:

| Ação | Sem Ctrl | Com Ctrl |
| ---- | -------- | -------- |
| Clique numa unidade | substitui a seleção | alterna aquela unidade |
| Arraste de área | substitui | soma |
| Clique numa estrutura | limpa a seleção e abre o painel | abre o painel **sem** limpar |
| Clique no vazio | limpa tudo | não faz nada |

As duas últimas linhas importam tanto quanto as primeiras: sem elas, montar um grupo com Ctrl seria desfeito por um clique impreciso.

Ambas as operações limpam o comando armado (`activeCommand`), igual às existentes — mudar a seleção com um comando pendente desarma o comando, senão o clique seguinte executaria a ordem sobre um grupo diferente do que o jogador viu ao armá-la.

---

## 19. Base e efetivo em ataque/armadura — IMPLEMENTADO (pré-requisito de 15)

`attack` e `defense` eram valores únicos, então um modificador de equipamento não teria como ser removido com exatidão: somar e subtrair acumula erro, e não há de onde recuperar o valor limpo.

`Combatant` e `Unit` agora têm **`baseAttack`/`baseDefense`** ao lado dos efetivos. O combate lê o **efetivo** (`rollDamage(action, attacker.attack, target.defense)`); o base fica intocado como referência.

**O dado segue declarando um valor só.** `createEnemy` e `spawnUnit` copiam `def.attack` para os dois campos. Isso difere de propósito do padrão de `speed`/`baseSpeed` e `efficiency`/`baseEfficiency`, que **duplicam os dois no JSON** — duplicação que pode divergir em silêncio, a mesma classe de problema do `combatRange` da seção 10. Vale alinhar aqueles ao padrão novo num item futuro.

Ainda não há nada que modifique o efetivo: isso chega com equipamento (seção 15) e com buffs. O que existe agora é a estrutura para que esses sistemas mexam no efetivo sem perder o base.

---

## 20. Pathfinding — PLANEJADO (pré-requisito de qualquer estrutura sólida)

Hoje **nada colide com nada**. `updateUnitPositions` e `updateEnemyAI` movem em linha reta para o destino:

```ts
unit.position.x += (dx / dist) * actualSpeed;
```

A única coisa parecida com terreno é o `isInWater`, e ele só troca a velocidade (`swimSpeed`) — não impede a passagem. Aquático é a exceção: um inimigo `aquatic` recusa um destino fora da água, mas isso é um teste no destino, não no caminho.

Sem pathfinding, uma muralha é decoração: as unidades atravessam. Por isso ele vem antes de muralha, portão, ou qualquer estrutura que bloqueie.

### Caminho sugerido

**Grade de navegação, no mesmo espírito da grade de ocupação de água** que já prototipei na seção 9 (32px por célula, 24KB para o mapa de 5000×5000, construída em 47ms). O mundo é estático fora das construções, então a grade só precisa ser reconstruída quando uma estrutura sólida nasce ou morre — e aí só nas células que ela cobre.

Com a grade: **A\*** sobre células, e o resultado é uma lista de waypoints que o movimento existente já sabe seguir — `patrolRoute` do verme (seção 5) faz exatamente isso, andar de waypoint em waypoint. Reusar aquele formato evita um sistema de movimento paralelo.

### Onde vai doer

- **Custo por frame.** A seção 9 mostrou que a simulação já era o gargalo, e que `updateCombat` domina com muitos inimigos. A\* por entidade por frame é inviável; o caminho precisa ser calculado **uma vez por ordem** e guardado (`unit.path?: Position[]`), recalculado só quando bloqueado ou quando a ordem muda.
- **Orçamento por frame.** Com 300 inimigos, mesmo um A\* por ordem cria picos. Vale uma fila: N caminhos por frame, o resto espera um tick.
- **Encalhe.** Unidade dentro de área que virou sólida (muralha construída em cima dela) precisa de saída, senão fica presa para sempre.
- **Fluidez.** A\* em grade dá caminhos "quadrados". Suavizar por line-of-sight (pular waypoints que têm visão direta) é barato e melhora muito.

### Decisão aberta

Colisão **entre entidades** entra ou não? Hoje unidades se sobrepõem livremente, e os comandos já mitigam isso espalhando o grupo em anel (`evenlySpacedAngles`). Colisão entidade-entidade é bem mais caro que colisão com terreno estático, e o jogo funciona sem ela — sugiro deixar fora do escopo e resolver só o bloqueio por estrutura.

---

## Ordem recomendada

1. **Ataque/Defesa** (seção 1) — base isolada, sem dependência de nada do verme, dá pra validar sozinha.
2. **Comida consumida por dia** (seção 2) — independente do verme; recursos novos ficaram para um batch posterior.
3. **`hostileToAll`** (seção 3) — pequeno, testável isoladamente com qualquer inimigo existente antes do verme entrar em cena.
   - **3b. Carcaças** — loot vira recurso no chão; pré-requisito para o verme fazer sentido como loot farm.
4. **Identidade de região** (seção 4) — FEITO. Pré-requisito do verme (seção 5) e do cap por região (seção 8).
5. **Verme: spawn/rota/comportamento** (seção 5) — FEITO.
6. **Ninho: saque/respawn/UI** (seção 6) — FEITO.
7. **Fauna passiva** (seção 7) — FEITO. Capivara como animal caçável; base para outros pacíficos.
8. **Taxa e cap por região no spawn** (seção 8) — depende da seção 4, como o verme.
10. **Alcance derivado** (seção 10) — FEITO.
11. **Ataques novos** (seção 11) — FEITO. charge, poisonSting, evilMagicRay.
12. **Construção** (seção 12) — base de 13, 14 e 15. Estoque **tem** posição física, o que encarece bastante.
13. **Teto de inventário** (seção 13) — depende de 12.
14. **Teto de população** (seção 14) — depende de 12; cuidado para não reusar `maxOccupancy`.
15. **Inventário e equipamento das unidades** (seção 15) — depende de 12; o `baseAttack`/`baseDefense` já existe (seção 19).
16. **Prestígio e rogue-lite** (seção 16) — independente das outras; a tela de meta-progressão é a maior peça.
17. **Painel de unidades** (seção 17) — independente, e todo o estado necessário já existe.
18. **Ctrl+clique** (seção 18) — FEITO.
19. **Base/efetivo em ataque e armadura** (seção 19) — FEITO. Pré-requisito de 15.
20. **Pathfinding** (seção 20) — pré-requisito de muralha e de qualquer estrutura sólida.

9. **Performance** (seção 9) — A–D1 feitos, mais as duas correções de `isInWater` que o profile revelou (simulação 4,4x mais rápida com 100 inimigos). O gargalo atual é `updateCombat`.

## Verificação

- `npx nuxt typecheck` limpo depois de cada seção.
- Fórmula de Ataque/Defesa, rota de patrulha (fica dentro do polígono?), unicidade por região, escolha de saque e agendamento de respawn: tudo validável por script manipulando o estado da store direto (mesmo método usado o jogo inteiro nesta sessão) — sem depender de UI visual.
- Testes visuais (ninho no mapa, modal de escolha, verme enfurecido perseguindo) ficam com o Pedro.
