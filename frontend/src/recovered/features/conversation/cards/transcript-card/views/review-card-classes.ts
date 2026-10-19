export const reviewCardClasses = {
  widget: "sand-1g0q52m",
  card: "sand-h8yej3 sand-euugli sand-gqmno8 sand-b3r6kr sand-78zum5 sand-dt5ytf sand-883omv sand-c7ga6q sand-tyxrsu",
  header: "sand-78zum5 sand-6s0dn4 sand-167g77z sand-euugli",
  title: "sand-1iyjqo2 sand-s83m0k sand-euugli sand-j0a0fe",
  group: "sand-euugli sand-1q4ynmn sand-b3r6kr",
  row: "sand-78zum5 sand-6s0dn4 sand-167g77z sand-euugli sand-m7lytj sand-1ykpatu sand-so031l sand-1q0q8m5",
  input: "sand-1lliihq sand-1iyjqo2 sand-s83m0k sand-1r8uery sand-euugli sand-193iq5w sand-9f619 sand-123j3cw sand-2vl965 sand-s9asl8 sand-e2zdcy sand-ng3xce sand-1qmwy7c sand-jbqb8w sand-tyxrsu sand-1qlqyl8 sand-jb2p0i sand-15bjb6t sand-4gjf66 sand-1h7ufjq",
  body: "sand-1lliihq sand-h8yej3 sand-euugli sand-1edz59j sand-5f5z56 sand-9f619 sand-tt52l0 sand-889kno sand-2vl965 sand-1a8lsjc sand-e2zdcy sand-ng3xce sand-jbqb8w sand-tyxrsu sand-jb2p0i sand-fc7y3v sand-1yxxptd sand-4gjf66 sand-b3r6kr sand-1t137rt sand-j0a0fe sand-126k92a",
  preview: "sand-10im51j sand-rxpjvj sand-889kno sand-1a8lsjc sand-jb2p0i sand-fc7y3v sand-1yxxptd sand-j0a0fe sand-126k92a",
  actions: "sand-78zum5 sand-6s0dn4 sand-167g77z",
  statusReady: "sand-3nfvp2 sand-6s0dn4 sand-2lah0s sand-f4egzd sand-dqyycr sand-hojbe8",
  statusSending: "sand-3nfvp2 sand-6s0dn4 sand-2lah0s sand-f4egzd sand-dqyycr sand-hojbe8 sand-169k319 sand-fwqdrz",
  statusSent: "sand-3nfvp2 sand-6s0dn4 sand-2lah0s sand-f4egzd sand-dqyycr sand-hojbe8 sand-181h0qd sand-1csozyq",
  statusDanger: "sand-3nfvp2 sand-6s0dn4 sand-2lah0s sand-f4egzd sand-dqyycr sand-hojbe8 sand-wtpwev sand-1a4mgn7",
  summary: "sand-euugli sand-b3r6kr sand-lyipyv sand-uxw1ft",
  formGrid: "sand-rvj5dj sand-1rnidkh sand-1mt1orb sand-pqajaz sand-18hwk67",
  formHeaderRow: "sand-78zum5 sand-dt5ytf sand-1iyjqo2 sand-xhr3t sand-euugli",
  formTitle: "sand-1fc57z9 sand-j0a0fe sand-126k92a sand-10im51j sand-fc7y3v sand-1yxxptd",
  formField: "sand-78zum5 sand-dt5ytf sand-1jnr06f sand-euugli",
  formLabelText: "sand-1o0liin sand-tyxrsu sand-fc7y3v sand-1yxxptd",
  formControlFrame: "sand-78zum5 sand-1qjc9v5 sand-euugli sand-193iq5w sand-21xpn4 sand-9f619 sand-mkeg23 sand-1y0btm7 sand-17tbahu sand-sb55g1 sand-10e981r sand-shfolx sand-1firant sand-wji4o3",
  formControl: "sand-1lliihq sand-1iyjqo2 sand-s83m0k sand-1r8uery sand-euugli sand-193iq5w sand-9f619 sand-123j3cw sand-2vl965 sand-s9asl8 sand-e2zdcy sand-ng3xce sand-1qmwy7c sand-jbqb8w sand-tyxrsu sand-1qlqyl8 sand-jb2p0i sand-15bjb6t sand-4gjf66 sand-1h7ufjq",
  formLock: "sand-78zum5 sand-1cy8zhl sand-17d4w8g sand-w7yly9 sand-169k319",
  formError: "sand-1iyjqo2 sand-s83m0k sand-1r8uery sand-euugli sand-10im51j sand-135b78x sand-i69oq4",
  formShell: "sand-jp7ctv",
  buttonRoot: "sand-3nfvp2 sand-6s0dn4 sand-l56j7k sand-1jnr06f sand-2lah0s sand-9f619 sand-c342km sand-ng3xce sand-jbqb8w sand-1ypdohk sand-tgyt42 sand-s2xxs2 sand-9lcvmn",
  buttonMedium: "sand-1yrsyyn sand-pdmqnj sand-10b6aqq sand-1g0dm76 sand-149ho13",
  buttonPrimary: "sand-8rotk8 sand-1sxibbd sand-1ialtwx sand-sa7k8x sand-g7klql",
  buttonSecondary: "sand-fwqdrz sand-19jy9ex sand-1g6zli8 sand-tyxrsu sand-g7klql",
  buttonCard: "sand-2lah0s sand-10w6t97 sand-149ho13 sand-pdmqnj sand-1g0dm76 sand-fc7y3v sand-1yxxptd",
  buttonCardTinted: "sand-5fd6op sand-fwqdrz sand-19jy9ex sand-tyxrsu",
  buttonSending: "sand-1hc1fzr sand-1axzn7n sand-x1phaw",
  bodyStack: "sand-euugli sand-b3r6kr",
  signature: "sand-1lliihq sand-h8yej3 sand-euugli sand-5f5z56 sand-9f619 sand-tt52l0 sand-889kno sand-2vl965 sand-1a8lsjc sand-e2zdcy sand-ng3xce sand-jbqb8w sand-tyxrsu sand-jb2p0i sand-fc7y3v sand-1yxxptd sand-4gjf66 sand-b3r6kr sand-1t137rt sand-j0a0fe sand-126k92a",
} as const;

export function reviewButtonClass(variant: "primary" | "secondary", sending = false): string {
  const parts: string[] = [
    reviewCardClasses.buttonRoot,
    reviewCardClasses.buttonMedium,
    sending ? reviewCardClasses.buttonSending : reviewCardClasses.buttonCard,
  ];
  if (variant === "primary") parts.push(reviewCardClasses.buttonPrimary);
  else parts.push(reviewCardClasses.buttonSecondary, reviewCardClasses.buttonCardTinted);
  return parts.join(" ");
}

export function draftStatusClass(state: "editable" | "sending" | "sent" | "discarded" | "unconfirmed" | "draft-created"): string {
  if (state === "sent" || state === "discarded" || state === "draft-created") return reviewCardClasses.statusSent;
  if (state === "unconfirmed") return reviewCardClasses.statusDanger;
  if (state === "sending") return reviewCardClasses.statusSending;
  return reviewCardClasses.statusReady;
}
