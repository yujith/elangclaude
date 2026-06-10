// Curated topic pool for Listening generation. When the caller doesn't
// pass an explicit topic hint, pick one of these at random and pass it
// through. This is defence-in-depth against the LLM defaulting to the
// same handful of topics every generation (the prompt also says "don't",
// but a fresh user-turn hint forces the model's hand).
//
// Topics are written as the FULL "Broad topic hint" string the user
// turn already supports — one cohesive phrase per generation that
// shapes all four parts.
//
// Shared by the SuperAdmin generate action and the ADR-0024 automation
// runner (extracted from generate-actions.ts, whose "use server" pragma
// forbids non-action exports).

const TOPIC_SEED_POOL: readonly string[] = [
  "renting a holiday flat by the sea, with a tour of a coastal cliff trail and a lecture on coastal erosion",
  "joining a community choir, an audio guide at a historical theatre, a tutorial on music production coursework, and a lecture on the evolution of opera houses",
  "applying for a swimming pool membership, a radio segment on city recycling, two students debating environmental science methodology, and a lecture on the economics of recycling",
  "booking a campsite for a family trip, a national park ranger briefing, students planning a geology field trip, and a lecture on glacial landscapes",
  "ordering catering for a wedding, a podcast on regional food festivals, two students reviewing a marketing dissertation, and a lecture on the psychology of decision-making",
  "scheduling a vet appointment for a rescue dog, a museum audio guide about marine life, a tutor and student refining a public-health research proposal, and a lecture on the neuroscience of sleep",
  "signing up for a cooking class, a city walking-tour app voiceover, students planning a sociology presentation on housing, and a lecture on the architecture of social housing",
  "hiring camera equipment for a film project, a community art exhibition opening, a tutorial about a film-studies dissertation, and a lecture on the history of cartography",
  "returning a faulty appliance under warranty, a food-bank volunteer induction, students refining a linguistics case study, and a lecture on the sociolinguistics of dialect",
  "claiming insurance on a damaged parcel, a train-station announcement on schedule changes, two students reviewing peer feedback on an industrial-design project, and a lecture on materials science of textiles",
  "joining a language exchange group, an in-flight safety briefing, students planning an urban-planning fieldwork project, and a lecture on the archaeology of trade routes",
  "registering for a cycling club, a podcast on local hiking trails, students debating a research methodology in ecology, and a lecture on the evolution of children's literature",
];

export function pickTopicSeed(): string {
  const idx = Math.floor(Math.random() * TOPIC_SEED_POOL.length);
  return TOPIC_SEED_POOL[idx]!;
}
