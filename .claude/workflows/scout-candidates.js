export const meta = {
  name: 'scout-candidates',
  description: 'Pain-mining scout: finds candidate products by hunting documented producer pain (lost batches, monitoring burden, skill scarcity) plus measured demand proxies',
  whenToUse: 'Run BEFORE a market-analysis round to generate evidence-born candidates instead of brainstormed ones. args: { domains?: [strings], perScout?: number }',
  phases: [
    { title: 'Mine', detail: 'one scout per domain hunting producer pain + sold-listing demand proxies' },
    { title: 'Sift', detail: 'one sifter dedupes, applies entry rules, outputs the shortlist' },
  ],
}

const cfg = args || {}
const DOMAINS = cfg.domains || [
  'fermented and aged foods (koji, miso, tempeh, vinegar, cured/aged products, bread levain, cheese affinage) — where do artisan producers publicly complain about lost batches, incubation drift, monitoring burden?',
  'controlled-environment growing beyond mushrooms (propagation, grafting healing, seedling plugs, orchids/rare plants, tissue culture, forcing) — where does climate-control skill decide success rates and who complains about it?',
  'live-culture and small-livestock hobby trades (aquarium cultures, corals, invertebrates, live feeds, hatching eggs, queen bees) — where do sellers publicly struggle with crashes, mortality, consistency, and what actually SELLS (eBay sold counts)?',
  'process-heavy craft materials and inputs (wood stabilisation, malting, drying/curing timber or botanicals, resin curing, kiln processes) — where is the process the whole product and UK supply thin?',
  'small-scale food processing where consistency is the moat (roasting profiles, dehydration, freeze-drying for others, nixtamal, chocolate, syrups) — where do micro-producers fail on repeatability?',
  'subscription-able consumables for niche hobbies (cultures, feeds, refills, starters) — recurring purchase products a solo automated producer could make with higher uptime than incumbents',
]
const PER_SCOUT = cfg.perScout ?? 5

const CONTEXT = `
OPERATOR: solo engineer (sensors, Pi, local AI vision, closed-loop control), Rome now / Edinburgh later, £10k, home-first, online-only sales, ≤20h/wk.
THE CRITERION a candidate must fit: real existing demand + the incumbent producers' binding constraint is PROCESS-shaped (continuous monitoring, batch losses, skill scarcity, consistency) — because that is what the operator's sense-decide-act stack removes, creating a cost/consistency/capacity position others cannot match. Growth mechanics required: repeat purchase, biologically compounding inventory, or capacity that scales by adding chambers/racks instead of people.
COMMODITY-APPLIANCE KILL TEST (earned by the black-garlic fermenter miss): if a consumer appliance or controller ≤€300 on Amazon/AliExpress/eBay already solves the process bottleneck for an untrained buyer (black-garlic fermenters €70-150, biltong boxes £60-150, yogurt/natto incubators €30-60, dehydrators, proofing boxes, reptile thermostats, £20 PID controllers), the pain is already commoditized and the candidate FAILS unless it has a different verified edge. Check this before proposing; "the machine exists but ours has sensors" is not an edge.
ALREADY ANALYSED (do NOT propose again): gourmet mushrooms & every mushroom derivative (kits, powder, logs, spawn), black garlic, hot honey, dog treats, ornamental shrimp, dahlia tubers, kindling, coffee roasting, wasabi, saffron, microgreens, tissue-culture houseplants, coastal halophytes/oyster leaf, edible flowers, moss/terrariums, aquarium plants, snails, quail eggs, vermicompost, freeze-dried candy, bonsai, insects for feed, seaweed, mead, christmas trees, watercress, RAS fish, chilli sauce, grow controllers/SaaS/courses, heritage seeds, herb plugs, willow, truffle saplings, biochar, sea buckthorn, rhubarb, hatching eggs, nucs/queens, peony, snowdrops, carnivorous plants, succulents, chilli plants, hops, garlic seed, dried flowers, cut flowers, chocolate bean-to-bar, herbal tea, kombucha, pickles/ferments, micro-bakery, tempeh, vinegar, miso, cheese affinage, phytoplankton/copepods, coral frags, isopods, grafted vegetable plants.`

const MINE = `
You are a scout. Your job is DISCOVERY with evidence, not analysis. In your domain, hunt for product opportunities the operator has NOT already analysed, using two hunts:
HUNT 1 — PAIN MINING: search forums, Reddit, Facebook-group posts surfacing in search, blog post-mortems, trade press for PRODUCERS publicly complaining about: lost batches, contamination/mortality, "can't scale", "up at 3am checking", monitoring burden, inconsistency, skill shortage. A craft that complains like this is process-bottlenecked — exactly the criterion. Capture the actual quote/complaint with URL.
HUNT 2 — DEMAND PROXY: for each candidate, find a measurable transaction signal — eBay UK sold-listing counts, Etsy review velocity on comparable products, sold-out notices, waiting lists — with URL. No proxy, no candidate.
Return up to ${'' + (cfg.perScout ?? 5)} candidates. Each MUST have: the pain evidence (quote + URL), the demand proxy (number + URL), one live price, the growth mechanic (repeat purchase / compounding inventory / chambers-not-people), and a one-line reason the operator's stack removes the pain. Fewer, better-evidenced candidates beat filler.`

const MINE_SCHEMA = {
  type:'object', required:['domain','candidates'],
  properties:{
    domain:{type:'string'},
    candidates:{type:'array', items:{type:'object',
      required:['key','name','pain_evidence','pain_url','demand_proxy','demand_url','live_price','growth_mechanic','stack_fit'],
      properties:{
        key:{type:'string'}, name:{type:'string'},
        pain_evidence:{type:'string', description:'the producer complaint, quoted or closely paraphrased'},
        pain_url:{type:'string'},
        demand_proxy:{type:'string', description:'the measured transaction signal with its number'},
        demand_url:{type:'string'},
        live_price:{type:'string'},
        growth_mechanic:{type:'string'},
        stack_fit:{type:'string', description:'one line: which loop of the stack removes the pain'},
      }}}
  }
}

phase('Mine')
log('Launching ' + DOMAINS.length + ' scouts…')
const mined = (await parallel(DOMAINS.map((d, i) => () =>
  agent(CONTEXT + '\n' + MINE + '\n\nYOUR DOMAIN: ' + d,
    { label:'scout:' + (i+1), phase:'Mine', schema: MINE_SCHEMA, model: 'opus' })
))).filter(Boolean)
const all = mined.flatMap(m => m.candidates || [])
log(all.length + ' raw candidates mined')

phase('Sift')
const SIFT_SCHEMA = {
  type:'object', required:['shortlist','rejected'],
  properties:{
    shortlist:{type:'array', items:{type:'object', required:['key','name','brief','why_top'], properties:{
      key:{type:'string'}, name:{type:'string'},
      brief:{type:'string', description:'ready to paste into market-analysis args: pain + demand proxy + price + growth mechanic + what to verify'},
      why_top:{type:'string'}}}},
    rejected:{type:'array', items:{type:'object', required:['key','why'], properties:{key:{type:'string'}, why:{type:'string'}}}},
  }
}
const sifted = await agent(CONTEXT + `
You are the sifter. Below are raw mined candidates. Dedupe, drop anything on the already-analysed list, drop anything whose evidence is weak (no real quote, no transaction proxy), drop anything that fails the COMMODITY-APPLIANCE KILL TEST above (run quick searches yourself: if a ≤€300 appliance already solves the pain, reject and name the appliance), drop obvious regulatory dead-ends (alcohol excise at home, animal-product approval walls — unless the candidate is strong enough to be worth the wall, then say so). Rank by: strength of pain evidence × demand proxy × growth mechanic. Output the top 6-8 as a shortlist with briefs READY for the market-analysis workflow (each brief must carry its evidence URLs), and list the rejected with one-line reasons.

RAW CANDIDATES:
` + JSON.stringify(all),
  { label:'sift', phase:'Sift', schema: SIFT_SCHEMA, model: 'opus' })

return { shortlist: (sifted && sifted.shortlist) || [], rejected: (sifted && sifted.rejected) || [], raw_count: all.length }
