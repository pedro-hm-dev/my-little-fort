import { ResourceType } from "@/types/Resource";

/** Portuguese names for every resource, shared by the panels that list stock. */
export const RESOURCE_LABELS: Record<ResourceType, string> = {
  [ResourceType.Wood]: "Madeira",
  [ResourceType.Stone]: "Pedra",
  [ResourceType.Metal]: "Metal",
  [ResourceType.Gold]: "Ouro",
  [ResourceType.Fish]: "Peixe",
  [ResourceType.Mushroom]: "Cogumelo",
  [ResourceType.Cactus]: "Cacto",
  [ResourceType.Meat]: "Carne",
  [ResourceType.Leather]: "Couro",
  [ResourceType.Algae]: "Alga",
  [ResourceType.WhiteMeat]: "Carne Branca",
  [ResourceType.Fat]: "Gordura",
  [ResourceType.LegendaryFang]: "Presa Lendária",
  [ResourceType.Poison]: "Veneno",
  [ResourceType.Egg]: "Ovo",
  [ResourceType.Carcass]: "Carcaça",
  [ResourceType.PlantFiber]: "Fibra Vegetal",
};
