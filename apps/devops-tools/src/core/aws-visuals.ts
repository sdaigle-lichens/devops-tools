// How a container is drawn.
//
// The colours are AWS's own published architecture-diagram convention, not a palette anyone here
// invented — they are what make a box read as "VPC" before you have read the label. Keeping them
// in one table rather than inline in the node component is what lets the isolation test and the
// legend agree with the canvas.

import type { ContainerRole } from "./board-schema.js";

export interface ContainerStyle {
  /** Shown small above the node's own label — "VPC", "Availability Zone". */
  heading: string;
  /** Border colour, and the colour of the heading text. */
  color: string;
  /** Whether the border is drawn dashed, as AWS draws availability zones. */
  dashed: boolean;
}

const CONTAINER_STYLES: Record<ContainerRole, ContainerStyle> = {
  region: { heading: "Region", color: "#00a4a6", dashed: true },
  vpc: { heading: "VPC", color: "#8c4fff", dashed: false },
  availability_zone: {
    heading: "Availability Zone",
    color: "#00a4a6",
    dashed: true,
  },
  public_subnet: { heading: "Public subnet", color: "#248814", dashed: false },
  private_subnet: {
    heading: "Private subnet",
    color: "#147eba",
    dashed: false,
  },
  group: { heading: "Group", color: "#7d8998", dashed: false },
};

const FALLBACK: ContainerStyle = CONTAINER_STYLES.group;

export function containerStyle(
  role: ContainerRole | undefined,
): ContainerStyle {
  return role ? CONTAINER_STYLES[role] : FALLBACK;
}

/** Every role and its style, for the canvas legend. Order is outermost-first, as drawn. */
export function containerLegend(): Array<{
  role: ContainerRole;
  style: ContainerStyle;
}> {
  return (Object.keys(CONTAINER_STYLES) as ContainerRole[]).map((role) => ({
    role,
    style: CONTAINER_STYLES[role],
  }));
}
