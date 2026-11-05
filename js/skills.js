// Ontario Learning Skills and Work Habits (Growing Success, 2010; provincial report cards Grades 1–12),
// with the sample behaviours listed on the report card.

export const SKILLS = [
  {
    code: "R", name: "Responsibility", short: "Responsibility", color: "#1f6f4a",
    behaviours: [
      "Fulfils responsibilities and commitments within the learning environment.",
      "Completes and submits class work, homework, and assignments according to agreed-upon timelines.",
      "Takes responsibility for and manages own behaviour.",
    ],
  },
  {
    code: "O", name: "Organization", short: "Organization", color: "#1565c0",
    behaviours: [
      "Devises and follows a plan and process for completing work and tasks.",
      "Establishes priorities and manages time to complete tasks and achieve goals.",
      "Identifies, gathers, evaluates, and uses information, technology, and resources to complete tasks.",
    ],
  },
  {
    code: "IW", name: "Independent Work", short: "Independent", color: "#6a1b9a",
    behaviours: [
      "Independently monitors, assesses, and revises plans to complete tasks and meet goals.",
      "Uses class time appropriately to complete tasks.",
      "Follows instructions with minimal supervision.",
    ],
  },
  {
    code: "C", name: "Collaboration", short: "Collaboration", color: "#c2410c",
    behaviours: [
      "Accepts various roles and an equitable share of work in a group.",
      "Responds positively to the ideas, opinions, values, and traditions of others.",
      "Builds healthy peer-to-peer relationships through personal and media-assisted interactions.",
      "Works with others to resolve conflicts and build consensus to achieve group goals.",
      "Shares information, resources, and expertise, and promotes critical thinking to solve problems and make decisions.",
    ],
  },
  {
    code: "I", name: "Initiative", short: "Initiative", color: "#00838f",
    behaviours: [
      "Looks for and acts on new ideas and opportunities for learning.",
      "Demonstrates the capacity for innovation and a willingness to take risks.",
      "Demonstrates curiosity and interest in learning.",
      "Approaches new tasks with a positive attitude.",
      "Recognizes and advocates appropriately for the rights of self and others.",
    ],
  },
  {
    code: "SR", name: "Self-Regulation", short: "Self-Regulation", color: "#ad1457",
    behaviours: [
      "Sets own individual goals and monitors progress towards achieving them.",
      "Seeks clarification or assistance when needed.",
      "Assesses and reflects critically on own strengths, needs, and interests.",
      "Identifies learning opportunities, choices, and strategies to meet personal needs and achieve goals.",
      "Perseveres and makes an effort when responding to challenges.",
    ],
  },
];

const BY_CODE = Object.fromEntries(SKILLS.map((s) => [s.code, s]));
export const skill = (code) => BY_CODE[code];
export const skillName = (code) => BY_CODE[code]?.name || code;

/** Small coloured tag(s) for a list of skill codes. `escFn` escapes text for HTML. */
export function skillTags(codes, escFn) {
  return (codes || []).filter((c) => BY_CODE[c]).map((c) =>
    `<span class="skill-tag" style="--sk:${BY_CODE[c].color}">${escFn(BY_CODE[c].name)}</span>`).join(" ");
}

/** Start of the current Ontario school year (Sept 1). */
export function schoolYearStart(now = new Date()) {
  const y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(y, 8, 1);
}
