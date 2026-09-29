/**
 * Monta as "fotos" do mapa e dos prédios que a tela lê (formato do contrato).
 */
import type { BuildingView, MapView } from "@city/contract";
import { BSTATE, type Buildings } from "../world/buildings";
import type { World } from "../world/world";

export function mapView(world: World): MapView {
  return {
    width: world.width,
    height: world.height,
    tileMeters: world.tileMeters,
    roads: world.roads.slice(),
    zones: world.zones.slice(),
    trees: world.trees.slice(),
    water: world.water.slice(),
    version: world.mapVersion,
  };
}

export function buildingView(b: Buildings, id: number): BuildingView {
  const t = b.typeOf(id);
  return {
    id,
    type: t.id,
    x: b.x[id]!,
    y: b.y[id]!,
    w: b.w[id]!,
    h: b.h[id]!,
    state: b.state[id]!,
    facing: b.facing[id]!,
    variant: b.variant[id]!,
    residents: b.residents[id]!,
    households: b.households[id]!,
    homesCapacity: t.homes,
    jobs: b.jobsFilled[id]!,
    jobsCapacity: t.jobs,
    students: b.students[id]!,
    studentsCapacity: t.students,
    patients: b.patients[id]!,
    patientsCapacity: t.patients,
  };
}

/** Todos os prédios que existem (não demolidos). */
export function buildingsView(b: Buildings): BuildingView[] {
  const out: BuildingView[] = [];
  for (let id = 0; id < b.count; id++) {
    if (b.state[id] !== BSTATE.demolished) out.push(buildingView(b, id));
  }
  return out;
}
