/**
 * Ferramentas do jogador: transforma cliques e arrastes no mapa em comandos.
 */
import type { BuildingView, Command, ZoneKind } from "@city/contract";
import type { TileEvent } from "@city/render";
import type { BuildingType, GameConfig } from "@city/sim";
import type { ToolDef } from "@city/ui";

export function toolDefs(config: GameConfig, catalog: BuildingType[]): ToolDef[] {
  const tools: ToolDef[] = [
    {
      id: "inspect",
      label: "Ver",
      icon: "🔍",
      group: "Outros",
      hint: "Clique num prédio para ver quem está ali.",
    },
    {
      id: "road:street",
      label: "Rua",
      icon: "🛣️",
      group: "Vias",
      hint: `Via local, ${config.roads.street.speedKmh} km/h. Arraste em linha reta.`,
      cost: config.roads.street.costPerTile,
    },
    {
      id: "road:avenue",
      label: "Avenida",
      icon: "🛤️",
      group: "Vias",
      hint: `Via arterial, ${config.roads.avenue.speedKmh} km/h, mais faixas. Arraste em linha reta.`,
      cost: config.roads.avenue.costPerTile,
    },
    {
      id: "zone:residential_low",
      label: "Casas",
      icon: "🏠",
      group: "Zonas",
      hint: "Residencial de baixa densidade (casas). Arraste um retângulo ao lado das vias.",
    },
    {
      id: "zone:residential_high",
      label: "Prédios",
      icon: "🏢",
      group: "Zonas",
      hint: "Residencial de alta densidade (prédios de apartamentos).",
    },
    { id: "zone:commercial", label: "Comércio", icon: "🏪", group: "Zonas", hint: "Lojas e escritórios." },
    { id: "zone:industrial", label: "Indústria", icon: "🏭", group: "Zonas", hint: "Galpões industriais." },
    {
      id: "zone:none",
      label: "Tirar zona",
      icon: "⬜",
      group: "Zonas",
      hint: "Remove a zona (só onde não tem prédio).",
    },
  ];
  for (const b of catalog.filter((t) => t.service)) {
    tools.push({
      id: `service:${b.id}`,
      label: b.label,
      icon: b.service === "school" ? "🏫" : "🏥",
      group: "Serviços",
      hint: `${b.w}x${b.h} quadradinhos, precisa encostar numa via. Obra de ${b.constructionMonths} meses.`,
      cost: b.cost,
    });
  }
  tools.push({
    id: "bulldoze",
    label: "Demolir",
    icon: "🧨",
    group: "Outros",
    hint: "Arraste para demolir vias e prédios.",
  });
  return tools;
}

export interface Preview {
  rect: { x0: number; y0: number; x1: number; y1: number } | null;
  valid: boolean;
}

/** Controla o arraste do mouse para a ferramenta ativa. */
export class ToolController {
  private start: TileEvent | null = null;
  private hover: TileEvent | null = null;

  constructor(
    private getTool: () => string,
    private catalog: BuildingType[],
    private send: (c: Command) => void,
    private select: (building: BuildingView | null) => void,
    private buildingAt: (x: number, y: number) => BuildingView | null,
  ) {}

  cancel() {
    this.start = null;
  }

  down(e: TileEvent) {
    const tool = this.getTool();
    if (tool === "inspect") {
      this.select(this.buildingAt(e.x, e.y));
      return;
    }
    if (tool.startsWith("service:")) {
      this.send({ type: "placeService", service: tool.slice(8), x: e.x, y: e.y });
      return;
    }
    this.start = e;
  }

  move(e: TileEvent) {
    this.hover = e;
  }

  up(e: TileEvent) {
    const tool = this.getTool();
    const s = this.start;
    this.start = null;
    if (!s) return;
    if (tool.startsWith("road:")) {
      const [x1, y1] = this.straight(s, e);
      this.send({ type: "buildRoad", kind: tool.slice(5) as "street" | "avenue", x0: s.x, y0: s.y, x1, y1 });
    } else if (tool.startsWith("zone:")) {
      this.send({ type: "zone", zone: tool.slice(5) as ZoneKind, x0: s.x, y0: s.y, x1: e.x, y1: e.y });
    } else if (tool === "bulldoze") {
      this.send({ type: "bulldoze", x0: s.x, y0: s.y, x1: e.x, y1: e.y });
    }
  }

  preview(): Preview {
    const tool = this.getTool();
    const h = this.hover;
    if (!h || tool === "inspect") return { rect: null, valid: true };
    if (tool.startsWith("service:")) {
      const t = this.catalog.find((b) => b.id === tool.slice(8));
      if (!t) return { rect: null, valid: false };
      return { rect: { x0: h.x, y0: h.y, x1: h.x + t.w - 1, y1: h.y + t.h - 1 }, valid: true };
    }
    const s = this.start;
    if (!s) return { rect: { x0: h.x, y0: h.y, x1: h.x, y1: h.y }, valid: true };
    if (tool.startsWith("road:")) {
      const [x1, y1] = this.straight(s, h);
      return { rect: { x0: s.x, y0: s.y, x1, y1 }, valid: true };
    }
    return { rect: { x0: s.x, y0: s.y, x1: h.x, y1: h.y }, valid: true };
  }

  /** Vias são retas: fica o eixo com maior deslocamento. */
  private straight(s: TileEvent, e: TileEvent): [number, number] {
    return Math.abs(e.x - s.x) >= Math.abs(e.y - s.y) ? [e.x, s.y] : [s.x, e.y];
  }
}
