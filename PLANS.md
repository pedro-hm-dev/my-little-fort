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

## 8. Spawn de inimigos: taxa e cap por instância de habitat — IMPLEMENTADO

Antes: `game.ts` rolava **35% por hora, uma vez, para todos os tipos juntos**, e o `ambientCap` era um teto global por tipo. Raridade não era configurável, e um mapa com 2 desertos tinha o mesmo número de diabos de poeira que um com 1.

### Dois campos por def

- **`spawnRate`** — chance por hora de jogo **e por instância de habitat**. É a raridade: mamute 0,08, capivara 0,50.
- **`biomeCap`** — teto **por instância**. O teto do mapa é `biomeCap × nº de instâncias`.

O `AMBIENT_SPAWN_CHANCE` global saiu de `game.ts`; `spawnAmbient` passa a ser chamado a cada hora e cada tipo rola o seu.

### Instância de habitat, não só região de bioma

O plano dizia "cap por região", mas isso tinha um furo: **grassland não tem regiões** — é o preenchimento default do mapa. A capivara mora lá, então com "por região" ela teria zero instâncias e **nunca spawnaria**.

A abstração que resolve é `HabitatInstance`, um lugar onde o habitat existe:

| Habitat | Instâncias |
| ------- | ---------- |
| `biome` com regiões | uma por região |
| `biome` sem regiões (grassland) | **uma implícita, cobrindo o mapa** |
| `lake` | uma por lago |
| `resource` | uma global (árvores são espalhadas, não há instância natural) |

Cada instância traz `contains(position)` e `sample()`. O `contains` é avaliado **na hora da rolagem**, não gravado no inimigo: animais andam, e um `regionId` copiado no spawn fica errado no instante em que o urso sai da tundra. Como roda 1x por hora, o custo do `pointInPolygon` é irrelevante — a mesma conclusão da seção 4.

### Teto resultante no mapa de teste (2 desertos, 1 tundra, 6 lagos)

| bicho | rate | cap | instâncias | teto |
| ----- | ---- | --- | ---------- | ---- |
| capivara | 0,50 | 8 | 1 (grassland) | 8 |
| piranha | 0,30 | 4 | 6 lagos | **24** |
| sapo piranha | 0,20 | 3 | 6 lagos | **18** |
| escorpião | 0,40 | 6 | 2 desertos | 12 |
| velociraptor | 0,30 | 6 | 2 desertos | 12 |
| diabo de poeira | 0,20 | 4 | 2 desertos | 8 |
| parassaurolofo | 0,15 | 3 | 2 desertos | 6 |
| lobo | 0,35 | 6 | 1 (recurso) | 6 |
| urso | 0,15 | 3 | 1 tundra | 3 |
| tigre | 0,12 | 2 | 1 tundra | 2 |
| mamute | 0,08 | 2 | 1 tundra | 2 |

**Total de ~101 inimigos ambient no cap**, e os aquáticos dominam: 42 dos 101, porque a geração faz muitos lagos. Vale considerar baixar piranha para 3 e sapo para 2 (teto cairia para 30). Em performance está tranquilo — a seção 9 mediu 100 inimigos em 25% do frame — mas 42 bichos na água é muito visualmente.

### Decisões que ficaram

- **A instância implícita de grassland é temporária.** Quando a seção 21 fizer grassland virar bioma com regiões próprias, esse caso especial pode sair e o cap da capivara passa a escalar com o número de campos.
- **`kind: "resource"` manteve cap global.** Não há instância natural: as árvores estão espalhadas por todo lado, e dividir por árvore daria um teto absurdo. Se um dia virar problema, o caminho é agrupar por cluster de recurso.
- **`packBiome`/`packSizeRange` sobreviveram** e são ortogonais ao `spawnRate`: a taxa decide *se* nasce, o pack decide *quantos* de uma vez. O lobo segue só fazendo matilha em floresta.

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

## 12. Sistema de construção — IMPLEMENTADO (base de 13, 14 e 15)

O jogo saiu do "só existe o forte": há um menu de construção, canteiro de obra, transporte de material por unidade e cinco estruturas novas. O fluxo é o do Banished — marca-se o canteiro, os trabalhadores buscam o material onde ele está e só então erguem a obra.

### Recurso novo: fibra vegetal

`plantFiber` entrou como matéria-prima de construção, com duas fontes:

- **Mato** (`high-grass`) em aglomerados por grassland e floresta, nunca no deserto nem na montanha. ~35 nós por mundo, 14 de fibra por nó.
- **Rendimento secundário** de material vegetal: árvore dá fibra em 30% das coletas, alga em 45%. Rolado por tique de coleta, em cima do recurso próprio, via `secondaryYield` na definição do recurso — qualquer recurso pode ganhar um secundário agora.

### As cinco estruturas

| Estrutura | Categoria | O que faz | Custo |
| --- | --- | --- | --- |
| Casa | housing | 4 de moradia, 4 de ocupação, **é onde se reproduz** | 30 madeira, 10 pedra, 15 fibra |
| Abrigo | housing | 12 de moradia e 12 de ocupação, **sem reprodução** | 45 madeira, 40 fibra |
| Estoque | storage | 300 de espaço, **recusa comida** | 20 madeira, 10 fibra |
| Galpão | storage | 250 de espaço, aceita tudo | 50 madeira, 15 pedra, 25 fibra |
| Forja | production | 3 vagas de trabalho; parada sem ninguém dentro | 40 madeira, 60 pedra, 20 metal |

A diferença casa/abrigo já tem consequência mecânica: **só a casa deixa reproduzir**. O abrigo é barato e cabe muita gente, mas não faz família. Isso é o gancho do sistema de conforto (seção 22) sem depender dele.

### O estoque tem posição física, como decidido

`inventoryStore` deixou de ser um pote global e virou **visão agregada** sobre `Structure.inventory`. Todo item está no inventário de alguma estrutura; o store soma tudo para a UI continuar respondendo "quanto a colônia tem".

- **Depositar escolhe destino.** `addResource(type, amount, near?)` procura o estoque **mais próximo** que aceita o tipo e tem espaço, transbordando para o próximo. Coleta e saque de ninho passam a posição de quem coletou, então o material vai para o depósito mais perto — o que dá razão de existir para construir um estoque longe do forte.
- **Estoque a céu aberto recusa comida** (`storageKind: "nonEdible"`), então comida sempre acaba no forte ou no galpão.
- **Retirar tira de onde está**, do depósito mais próximo primeiro.
- **Canteiro não é estoque nem moradia**: `readyStructures` filtra obra em andamento, e `housingCapacity`/`storageCapacity` só contam prontas.

### O fluxo da obra

1. Menu de construção (`BuildMenu.vue`) → clique no mapa → `placeBlueprint` cria a estrutura com `construction.pending` = custo cheio e **25% da vida**. Pode-se marcar canteiro sem ter o material; ele fica esperando, como no Banished.
2. Comando **Construir** na barra de ações → clique no canteiro → as unidades recebem `buildTargetId`.
3. Cada unidade, por frame: se tem carga, leva ao canteiro e abate da dívida; se o canteiro ainda deve algo, vai ao depósito mais próximo que tenha aquele material e pega até 12 por viagem; se está tudo entregue, ergue a obra a `efficiency / buildTimeHours`.
4. `pending` zerado e `progress` em 1 → a estrutura perde o canteiro e volta à vida cheia.

Qualquer outra ordem cancela a obra e **devolve a carga ao estoque** em vez de evaporar com ela. Sem material em lugar nenhum, o construtor espera no canteiro em vez de sair andando.

### Detalhes que valem lembrar

- **Canteiro é atravessável.** `solidRadius` só é estampado na grade de navegação para `readyStructures` — senão o construtor não chegaria na própria obra.
- **Canteiro não abre painel** e não aceita ocupante: não é prédio ainda.
- **Ocupante deixou de ser `canReproduce`.** Quem pode entrar agora vem de `occupants ?? canReproduce`, porque o abrigo e a forja aceitam gente sem serem locais de reprodução. A forja aceita só trabalhador e mineiro.
- **`solidRadiusOf` saiu para `stores/structures.ts`** e é compartilhado com navegação e combate.

### Rendimento por trabalhador

`workerEfficiencyAt(structureId)`: **zero sem ninguém dentro**, e cada trabalhador a mais soma 60% do anterior — 1 trabalhador 1,00x, 2 dão 1,60x, 3 dão 1,96x. Ordena por eficiência antes de aplicar o decaimento, então o melhor conta cheio. A aba **Trabalho** do painel mostra isso e diz "Parada" quando está vazia.

A forja ainda não produz nada: o crafting depende do inventário das unidades (seção 15). O que existe é a regra, testada e visível.

### O que ficou de fora, de propósito

- **Teto de estoque e teto de população** ficaram para as seções 13 e 14, que foram feitas na sequência.
- **Unidade não carrega para coletar.** A coleta continua creditando na hora (no depósito mais próximo). Carga e slots são a seção 15; o transporte de obra já é o mesmo mecanismo que ela vai reusar.
- **Muralha não entrou.** Agora é possível (seção 20 está feita), mas `stampCircle` é círculo e muralha é segmento.

---

## 13. Limite de inventário por estrutura — IMPLEMENTADO

O teto passou a valer de verdade, e a resposta ao encher é a do Banished: **o excedente fica no chão**.

- `addResource` guarda o que cabe no estoque mais próximo que aceita o tipo, transborda para o próximo, e o que sobrar cai como **pilha no chão** onde quem carregava estava. Devolve quanto entrou.
- A pilha é um `Resource` normal com `dropped: true`, ícone do próprio recurso e `gatherTime` curto (2 — é mercadoria já processada, não árvore para derrubar). **Não apodrece**, ao contrário da carcaça.
- **Pilhas do mesmo tipo a até 60 unidades se fundem**, senão um trabalhador esvaziando uma colônia cheia deixaria um rastro de pilhas de 1.
- **A pilha nunca cai dentro de corpo sólido.** `dropPile` empurra o ponto para a célula andável mais próxima via a grade de navegação — descoberto por teste, porque uma pilha largada no centro do forte ficava a 82 do centro e o alcance de coleta é 50: ninguém conseguia pegá-la nunca mais.
- **Ocioso recolhe.** `assignIdleHauling` (a cada 400ms de jogo) oferece a pilha mais próxima a quem não tem ordem nenhuma — e **só quando algum estoque aceitaria aquele tipo**, senão o carregamento terminaria com a pilha de volta no chão. Coletar já deposita no depósito mais perto, então recolher é uma ordem de coleta comum.
- **Coletar pilha sem lugar para guardar cancela a ordem** em vez de girar em falso: a pilha voltaria ao chão a 50 de distância, dentro do raio de fusão, e a unidade coletaria para sempre sem progresso.

Consequência de design que vale notar: encher o estoque não trava mais nada, mas espalha material pelo mapa, e construir um estoque novo **destrava o recolhimento sozinho** — os ociosos varrem o chão sem nenhuma ordem do jogador.

**Ainda em aberto:** o teto é global por estrutura, não por tipo de recurso. Por tipo obrigaria a planejar espaço e é mais interessante, mas nenhum sistema pede isso hoje.

---

## 14. Teto de população — IMPLEMENTADO

`populationCap` é `structureStore.housingCapacity` — soma de `housing` das estruturas **prontas**: forte 10, casa 4, abrigo 12. Canteiro não conta.

- `startReproduction` recusa quando `population >= housingCapacity`, e `startPendingReproduction` nem arma o comando. Reprodução é o único caminho de entrada de unidade no jogo, então esses dois pontos bastam.
- O `UnitsTab` ganhou a linha **População x / y**, em vermelho no teto, e o botão de reproduzir desabilita com "Sem moradia" — distinto de "Lotado", que é a ocupação daquela estrutura específica.
- `maxOccupancy` continua significando outra coisa (quantos caibam dentro), como o plano avisava: são campos separados e o painel mostra os dois.

Sem teto máximo: casas somam indefinidamente. O custo real de população alta continua sendo a comida (seção 2) e a performance (seção 9).

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

**Fibra vegetal** entra como recurso simples (2 pontos), junto de madeira e pedra.

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

## 20. Pathfinding — IMPLEMENTADO (pré-requisito de qualquer estrutura sólida)

Antes disto nada colidia com nada: `updateUnitPositions` e `updateEnemyAI` andavam em linha reta até o destino, e `isInWater` só trocava a velocidade. Agora existe uma camada de navegação com grade de bloqueio, A\* e seguimento de waypoints, e o forte é a primeira estrutura sólida de verdade.

### O que foi feito

`app/utils/navGrid.ts` (novo, puro):

- **Grade de bloqueio** de 32 unidades por célula sobre o mapa de 5000×5000 — 157×157, 24KB, com um contador de `coverage` por célula para que remover uma estrutura não abra as células de outra que a sobrepõe.
- **`segmentIsClear`** por travessia de células (Amanatides-Woo), não por amostragem de pontos ao longo do segmento. Amostragem é exatamente o que atravessa uma parede de uma célula de espessura — está coberto por teste.
- **A\*** 8-direções, custo diagonal √2, sem corte de canto (a diagonal exige os dois ortogonais livres), heurística octile, heap binário e buffers reaproveitados entre chamadas com marca de geração, para não alocar 4 arrays de 24k por consulta.
- **Suavização por linha de visão**: o caminho bruto é uma escada; descartar todo waypoint que a entidade já vê passar reduz o desvio do forte a 3 waypoints.
- **`nearestOpenPoint`** (busca em anéis) e **`openPointToward`** (primeira célula livre voltando do alvo para quem anda).

`app/stores/navigation.ts` (novo): dona da grade, reconstruída por `watch` na lista de estruturas — só em construção ou destruição, nunca por frame (0,1ms). Expõe `routeTo(entity, dest, delta)`, que devolve o ponto a andar neste frame. `Unit` e `Enemy` ganharam `path`, `pathGoal` e `pathRetryMs` e satisfazem `Navigable` estruturalmente; o caminho mora na entidade, não numa tabela paralela.

Os dois laços de movimento passaram a andar em direção ao `steer` de `routeTo` em vez do destino cru. `combatRange` de estrutura passou a ser medido **até a borda** do corpo sólido.

### Por que o forte ficou sólido

Sem obstáculo nenhum a camada seria código morto e não verificável. O forte é o candidato natural: `solidRadius: 70` em `structureDefinitions.json`, bem dentro do `fortClearRadius` de 180 que já impede recurso de nascer ali, então nada fica preso atrás dele. É **um campo de JSON** — tirar é trivial se o comportamento não agradar.

### O custo, que foi medido três vezes porque as duas primeiras versões eram caras

Com 400 inimigos convergindo no forte (o pior caso real):

| versão | custo da camada |
| --- | --- |
| primeira | **7,4ms/frame** (+84% no movimento) |
| + rejeição barata e sem atravessar parede ao desistir | 3,7ms/frame |
| + destino realocado e raycast com alcance limitado | **~1,9ms/frame** (4,9µs por entidade) |

O que estava caro, e é a lição:

- **Destino dentro do sólido faz a multidão re-pathear todo frame.** A horda andava para o *centro* do forte, que é bloqueado, então o raycast nunca passava, o A\* realocava a meta, a entidade chegava, o caminho era descartado e no frame seguinte tudo de novo. O conserto foi `openPointToward`: uma ordem para dentro de uma parede vira ordem para a borda **do lado de quem anda**, o que mantém a linha reta livre.
- **Raycast até um destino distante custa proporcional à distância, por entidade, por frame** — e não compra nada, porque um obstáculo a 2000 unidades é descoberto com folga por quem continua andando. O teste passou a ir só até `LOOKAHEAD` de 420 unidades. Com segmento curto, a rejeição por `distanceToSegment` contra as pegadas sólidas passa a resolver quase tudo sem tocar na grade.
- **Desistir não pode significar atravessar a parede.** A primeira versão devolvia o destino quando o orçamento de A\* do frame acabava, o que fazia a entidade cortar direto pelo sólido. Agora ela **fica parada** um tick.

### O bug que quase foi para a main

Forte sólido de raio 70 com `clubSmash` de alcance 50 = o saqueador corpo a corpo **nunca alcançaria o forte**, e o jogo ficaria impossível de perder. A aquisição de alvo comparava a distância até o **centro** da estrutura. Passou a subtrair o raio sólido (`Target.radius`), de modo que alcance de estrutura se mede até a borda — que é o que faz sentido para um forte de 140 unidades de diâmetro e é o que vai valer para muralha e portão. Coberto por teste específico: o raider fecha a 119 do centro, 49 da borda, e bate.

### Decisões tomadas

- **Colisão entre entidades ficou fora**, como sugerido no plano. Unidades seguem se sobrepondo; o anel de `evenlySpacedAngles` continua sendo o que espalha o grupo.
- **Orçamento de 6 A\* por frame.** Quem não passa fica parado um tick, e há um cooldown de 1200ms depois de meta inalcançável para nada rodar A\* todo frame. O cooldown **não** é aplicado quando o caminho terminou na meta de verdade, senão a próxima ordem congelaria a unidade por um segundo.
- **Empurrão para fora do sólido** quando a entidade está dentro dele — é o caso de muralha construída em cima de alguém, que o plano previa como encalhe permanente.
- **Rebuild completo da grade**, não incremental. Uma alocação de 24KB mais um stamp por estrutura sólida, só em construção/destruição. O contador de `coverage` já deixa o caminho incremental aberto se um dia doer.

### O que vai precisar de atenção quando as muralhas chegarem

- A **rejeição por pegada** é O(nº de sólidos) e desliga acima de 24 pegadas, caindo para a travessia de células direto. Com muralhas às centenas isso quer uma grade grosseira (super-células de 8×8 marcando "tem algo sólido aqui"), no mesmo espírito da grade de água.
- **Raycast com alcance limitado entra em bolso côncavo.** Uma muralha em U faz a entidade andar para dentro e só então pedir caminho. Funciona, mas o movimento fica menos elegante que um A\* de longo alcance; se incomodar, o conserto é aumentar o `LOOKAHEAD` perto de aglomerado de sólido.
- **`solidRadius` é círculo.** Muralha é segmento, não círculo; `stampCircle` vai precisar de um irmão `stampSegment`.

---

## 21. Biomas cobrindo o mapa em polígonos complexos — IMPLEMENTADO

Grassland virou bioma de verdade, os cinco biomas particionam o mapa inteiro e as regiões são polígonos côncavos de fronteira recortada, não mais blobs circulares isolados num fundo de grassland.

### O que foi feito

`app/utils/biomeMap.ts` (novo) gera o mapa em cinco passos:

1. **Sementes jitteradas** numa treliça (`placeSeeds`), sem relaxação de Lloyd — ela regularizaria as células para hexágonos, o oposto do pedido.
2. **Rasterização**: cada célula da grade recebe o bioma da semente mais próxima, com a coordenada **deformada por domain warping** antes da busca. Bioma sorteado por peso — grassland 5, floresta 3, deserto 3, tundra 2, montanha 2.
3. **Flood fill** funde células adjacentes de mesmo bioma numa região só. É esse passo que produz o polígono complexo: uma região é a união de N células, não um blob.
4. **Regiões menores que `minRegionCells` (12) são absorvidas** pelo vizinho de maior fronteira, para não sobrar lasca de um bioma perdida dentro de outro.
5. **Traçado do contorno** por arestas de fronteira (`traceOutline`), com colapso de vértices colineares (`collapseCollinear`).

Do lado da store, `generateBiomeRegions`/`tryPlaceBiomeRegion`/`regionContains`/`biomeAtRegions` e as `BIOME_REGION_SPECS` saíram inteiros. `regionAt` e `biomeAt` agora são indexação de array na grade de região (`regionIndexAt`), e `buildBiomeTexture` lê a grade em vez de rodar ~4.000 consultas ponto-em-polígono.

### Números do mapa gerado

21 a 23 regiões, os cinco biomas sempre presentes, grassland com 4 a 6 regiões. Circularidade média 0,39 (1 = círculo), 59 vértices por contorno em média. Geração 18ms, consulta 0,079µs, cobertura de contorno 100%, rota do verme 102/102 waypoints dentro da região.

### Decisões tomadas

- **Grade de região é a fonte da verdade, não o polígono.** O contorno serve para desenhar e para amostrar bounding box; toda pergunta de pertencimento (`contains`, `sample`, validação de waypoint de patrulha) consulta a grade. Isso resolveu de uma vez o custo previsto de `biomeAt` e o problema dos buracos, já que a grade não tem a ambiguidade de anel externo vs interno.
- **Warp em duas oitavas** (900 de amplitude em 0,00055 de escala, mais 260 em 0,0022). Uma oitava só deixava as fronteiras visivelmente alinhadas aos eixos, porque a deformação era pequena diante do vão de ~830 unidades entre sementes.
- **Textura de bioma em célula 50, igual à grade.** Em 80 ela reamostrava as fronteiras para baixo e borrava justamente o recorte que era o objetivo.
- **Contraste das cores aumentado.** A paleta antiga foi desenhada quando grassland era o fundo; com os cinco biomas lado a lado, os tons ficavam indistinguíveis.
- **`bounds` e `cellCount` em `BiomeRegion`**, como previsto: com região côncava o descarte por `center` + raio não rejeita nada.

### Bugs achados no caminho

- **`traceOutline` truncava todo anel em ~50%.** O laço usava `edges.size` como limite, e o `Set` encolhe conforme as arestas são consumidas. Cobertura de contorno 49% → 100%. A hipótese inicial de "regiões com buracos" estava errada; era o laço.
- **Centróide de região côncava cai fora dela.** Como o `center` nasce o verme e o ninho, ele passou a ser a célula da região mais próxima do centróide.
- **`regionIndexAt` clampava coordenada fora do mapa** para a célula da borda, então ponto distante "pertencia" a uma região de beira. Passou a devolver -1.
- **Membros de matilha vazavam para a região vizinha** e estouravam o cap (velociraptor 27 de 24, capivara 33 de 32). Quando o espalhamento cai fora da instância, o membro volta para a âncora.
- **`sample()` usava `pointInPolygon`** no anel externo, que engloba buracos, e punha bicho no bioma errado. Passou a usar a grade.

### Efeitos nas outras seções

- **Seção 8**: o fallback `regions.length === 0` → uma instância do mapa continua no código como guarda, mas grassland não passa mais por ele: tem regiões próprias, e o cap da capivara agora escala com o número de campos (8 por região × 4 a 6 regiões = 32 a 48 capivaras no mapa, provavelmente alto demais — vale rever junto do cap aquático).
- **Seção 4**: `regionCountByBiome` passa a contar grassland com valor maior que zero.
- **Seção 5**: a amostragem por rejeição da rota de patrulha aguentou o polígono côncavo; não foi preciso triangular.

### Decisão aberta

Lagos e rios continuam independentes das fronteiras, gerados por cima. Podem passar a respeitar ou a definir limite de bioma, mas não há queixa disso hoje.

---

## 22. Conforto — PLANEJADO (motivo para casa em vez de abrigo)

Hoje a diferença entre casa e abrigo é binária: **casa deixa reproduzir, abrigo não**. Funciona como gancho, mas é grosseiro — o abrigo cabe 12 por 85 de material e a casa cabe 4 por 55, então a conta favorece abrigo para tudo que não seja crescer a população.

A ideia é um **conforto por unidade**, derivado de onde ela dorme e do que existe em volta, mexendo em coisas que já existem:

- **Velocidade de reprodução** (`reproductionTimeHours`) escala com o conforto do lar, em vez de reprodução ser um sim/não.
- **Cura no abrigo** (hoje 1% da vida por hora de jogo, em `updateFortUnits`) escala com o conforto.
- Talvez **consumo de comida** ou moral em combate, mas isso mistura sistemas; começar pelos dois de cima.

Fontes de conforto plausíveis: tipo da estrutura, quanto dela está ocupado (superlotação penaliza), estruturas próximas, e no futuro mobília construída dentro. O abrigo continua útil como solução de emergência e para população que só precisa de teto.

Decisão aberta: conforto é **por unidade** (cada uma carrega o seu, mais fiel ao Banished) ou **por estrutura** (mais simples, mas não modela superlotação de graça)?

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
8. **Taxa e cap por instância de habitat** (seção 8) — FEITO.
10. **Alcance derivado** (seção 10) — FEITO.
11. **Ataques novos** (seção 11) — FEITO. charge, poisonSting, evilMagicRay.
12. **Construção** (seção 12) — FEITO. Canteiro, transporte, cinco estruturas, estoque com posição física e fibra vegetal.
13. **Teto de inventário** (seção 13) — FEITO. Excedente vai ao chão e ocioso recolhe, como no Banished.
14. **Teto de população** (seção 14) — FEITO. `housingCapacity` das estruturas prontas barra a reprodução.
15. **Inventário e equipamento das unidades** (seção 15) — depende de 12; o `baseAttack`/`baseDefense` já existe (seção 19).
16. **Prestígio e rogue-lite** (seção 16) — independente das outras; a tela de meta-progressão é a maior peça.
17. **Painel de unidades** (seção 17) — independente, e todo o estado necessário já existe.
18. **Ctrl+clique** (seção 18) — FEITO.
19. **Base/efetivo em ataque e armadura** (seção 19) — FEITO. Pré-requisito de 15.
20. **Pathfinding** (seção 20) — FEITO. Grade de bloqueio, A\* com suavização, forte é o primeiro corpo sólido.
21. **Biomas cobrindo o mapa** (seção 21) — FEITO. Voronoi jitterado com merge, grade de região como fonte da verdade.
22. **Conforto** (seção 22) — depende de 12; é o que dá razão para casa em vez de abrigo.

9. **Performance** (seção 9) — A–D1 feitos, mais as duas correções de `isInWater` que o profile revelou (simulação 4,4x mais rápida com 100 inimigos). O gargalo atual é `updateCombat`.

## Verificação

- `npx nuxt typecheck` limpo depois de cada seção.
- Fórmula de Ataque/Defesa, rota de patrulha (fica dentro do polígono?), unicidade por região, escolha de saque e agendamento de respawn: tudo validável por script manipulando o estado da store direto (mesmo método usado o jogo inteiro nesta sessão) — sem depender de UI visual.
- Testes visuais (ninho no mapa, modal de escolha, verme enfurecido perseguindo) ficam com o Pedro.
