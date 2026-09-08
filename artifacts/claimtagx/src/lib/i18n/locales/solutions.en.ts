import type { TranslationTree } from "../types";

/** English solution-page copy (route slugs unchanged) */
export const solutionsEn: TranslationTree = {
  chrome: {
    forBrand: "ClaimTagX for {name}",
    problemEyebrow: "The Problem",
    problemTitle: "What paper costs {audienceLead}",
    howEyebrow: "How It Works",
    howTitle: "Three taps. No paper.",
    faqEyebrow: "FAQ",
    faqTitle: "{name} questions",
    alsoWorksFor: "ClaimTagX also works for:",
    imageAlt: "{name} with ClaimTagX",
    breadcrumbHome: "Home",
    breadcrumbSolutions: "Solutions",
  },
  channels: {
    qr: "QR Code",
    nfc: "NFC",
    sms: "SMS",
    whatsapp: "WhatsApp",
    email: "Email",
    ble: "BLE",
    push: "In-app push",
  },
  valet: {
    name: "Valet Parking",
    audience: "hotels, restaurants, events, and parking operators",
    audienceLead: "hotels",
    seoTitle: "Valet Ticket Software — Digital Valet Claim Tickets | ClaimTagX",
    seoDescription:
      "Replace paper valet tickets with digital claim tags. Plate OCR, photo proof, SMS tickets, scan-to-release. Stop wrong-car releases and damage disputes. Free plan.",
    headline0: "Never release",
    headline1: "the wrong car again.",
    subhead:
      "Plate scanned, photos taken, digital ticket on the guest’s phone — in under 2 seconds at the podium. One scan at pickup verifies the right guest gets the right keys, every time.",
    pains: {
      "0": {
        title: "Wrong-car releases",
        description:
          "A mumbled ticket number on a busy Friday is how a $90,000 car leaves with the wrong driver. QR verification makes a mismatched release impossible.",
      },
      "1": {
        title: "The $5,000 scratch claim",
        description:
          "A guest claims door damage you know was already there. Without intake photos, you settle. With them, the dispute is over in thirty seconds.",
      },
      "2": {
        title: "The retrieval scramble",
        description:
          "Guests watching your runners hunt for keys are guests rewriting their tip and their review. Digital tickets show exactly which car, which row, which runner.",
      },
    },
    steps: {
      "0": {
        title: "Tag the car at the podium",
        description:
          "Snap photos, scan the plate with OCR, note the spot. A signed digital ticket is created in under 2 seconds.",
      },
      "1": {
        title: "Guest gets the ticket by text",
        description:
          "No app, no account. The claim ticket lives in their messages — it can’t be lost in a jacket pocket.",
      },
      "2": {
        title: "Scan to release the keys",
        description: "Guest shows the QR, runner scans, identity verified. Wrong car, wrong guest — physically impossible.",
      },
    },
    roiItemLabel: "Cars parked per night",
    faqs: {
      "0": {
        q: "Does this slow down the podium during rush?",
        a: "It’s faster than writing a paper stub. Plate OCR reads the car in under a second, and the whole intake — photos included — takes less time than tearing a ticket and handing it over.",
      },
      "1": {
        q: "What about underground garages with no signal?",
        a: "ClaimTagX is offline-first. Runners can issue and release tickets with zero connectivity; everything syncs the moment they’re back in range.",
      },
      "2": {
        q: "What if a guest loses the text with their ticket?",
        a: "Staff can re-send it instantly, or verify against the photos and phone number captured at intake. Unlike a paper stub, the record exists on your side too.",
      },
    },
    ctaHeadline: "Your podium, minus the paper.",
    channelNote: "Tap-to-verify NFC at the podium, SMS tickets for guests — pick what fits your stand.",
  },
  "dry-cleaning": {
    name: "Dry Cleaning & Laundry",
    audience: "dry cleaners, laundromats, and garment care services",
    audienceLead: "dry cleaners",
    seoTitle: "Dry Cleaning Ticket Software — Digital Garment Tags | ClaimTagX",
    seoDescription:
      'Replace paper laundry tickets with digital tags. Photo proof of garment condition at drop-off, pickup verification, full audit trail. End "I never dropped that off." Free plan.',
    headline0: '"I never dropped that off."',
    headline1: "Settled in one tap.",
    subhead:
      "Photo proof of every garment and its condition at drop-off. A digital ticket on your customer’s phone. Pickup verified with one scan — and a record that ends arguments before they start.",
    pains: {
      "0": {
        title: "Phantom garments",
        description:
          '"There were five shirts, not four." Without itemized photo intake, you eat the cost of clothes that were never there. With it, the count is documented and signed.',
      },
      "1": {
        title: "Pre-existing damage claims",
        description:
          "A stain or tear that walked in the door becomes your fault at pickup. Condition photos at drop-off settle it instantly — no refund, no argument, no lost customer.",
      },
      "2": {
        title: "Lost-ticket pickups",
        description:
          "Half your counter time goes to customers who lost the paper stub. A digital ticket lives in their messages — and your staff can look it up by name or phone in seconds.",
      },
    },
    steps: {
      "0": {
        title: "Photograph at drop-off",
        description: "Itemize garments with photos and condition notes. A signed digital ticket is issued in seconds.",
      },
      "1": {
        title: "Customer gets a digital stub",
        description: "Sent by text or email. No app to download, nothing to keep track of, nothing to lose in the wash.",
      },
      "2": {
        title: "Scan to hand back",
        description: "Customer shows the QR at pickup. Items verified against intake photos. Every handoff logged.",
      },
    },
    roiItemLabel: "Orders handled per day",
    faqs: {
      "0": {
        q: "Do my customers need a smartphone app?",
        a: "No. The ticket is a link sent by text or email, opened in any phone browser. Older customers who prefer paper can still be looked up by name or phone number at the counter.",
      },
      "1": {
        q: "How does photo intake not slow down my counter?",
        a: "A photo takes about as long as pinning a paper tag — and it eliminates the ten-minute disputes later. Most shops find intake is net faster within the first week.",
      },
      "2": {
        q: "Can I track garments through cleaning stages?",
        a: "Yes — higher tiers support workflow states, so a garment can move through received, cleaning, ready, and picked up, with a timestamped record at each step.",
      },
    },
    ctaHeadline: "Every garment accounted for.",
    channelNote: "Tickets land where your customers already are — text, WhatsApp, or email.",
  },
  luggage: {
    name: "Luggage & Bag Check",
    audience: "hotels, airports, event venues, and storage services",
    audienceLead: "hotels",
    seoTitle: "Luggage Check Software — Digital Bag Check Tickets | ClaimTagX",
    seoDescription:
      "Replace paper bag check tickets with digital claim tags. Fast intake during checkout rush, QR claim, chain of custody for every bag. No patron app. Free plan.",
    headline0: "Check 200 bags.",
    headline1: "Lose zero.",
    subhead:
      "Checkout rush, conference break, stadium gates — when bags pile up fast, paper tags fall apart. Digital tickets issue in seconds, live on the guest’s phone, and verify in one scan.",
    pains: {
      "0": {
        title: "The identical-bag problem",
        description:
          "Forty black roller bags in one closet. A handwritten tag is the only thing standing between a smooth pickup and handing a stranger someone’s laptop. Photos and QR matching end the guesswork.",
      },
      "1": {
        title: "High-value contents, zero record",
        description:
          "When a guest claims a missing item from a checked bag, a paper stub gives you nothing. Intake photos and a custody chain give your insurer — and your guest — real answers.",
      },
      "2": {
        title: "The checkout-rush bottleneck",
        description:
          "Twenty guests checking bags at 11am with one bell stand. Sub-2-second digital intake keeps the line moving without sacrificing the record.",
      },
    },
    steps: {
      "0": {
        title: "Tag bags at the desk",
        description: "Photo, count, and notes per guest. A signed digital ticket covers the whole group of bags.",
      },
      "1": {
        title: "Guest carries it on their phone",
        description: "The claim ticket is a text message — it survives a day of meetings, a flight, or a festival.",
      },
      "2": {
        title: "Scan to return",
        description: "QR verified, bags matched against photos, release logged. The custody chain closes cleanly.",
      },
    },
    roiItemLabel: "Bags checked per day",
    faqs: {
      "0": {
        q: "Can one ticket cover multiple bags?",
        a: "Yes — multi-asset support lets a single guest ticket cover a group of bags, each photographed and counted at intake.",
      },
      "1": {
        q: "What about international guests without local numbers?",
        a: "Tickets can be delivered by email as well as SMS, and work in any phone browser worldwide — no app store, no local SIM required.",
      },
      "2": {
        q: "Does it work at temporary venues like events?",
        a: "There’s no hardware to install — a coat-check or bag-drop station can be live on a staff phone in 60 seconds, and offline-first mode handles spotty venue Wi-Fi.",
      },
    },
    ctaHeadline: "Every bag back to its owner.",
    channelNote: "WhatsApp and email for international guests — no local SIM or app required.",
  },
  repair: {
    name: "Repair Services",
    audience: "jewelers, cobblers, tailors, and electronics repair shops",
    audienceLead: "jewelers",
    seoTitle: "Repair Shop Ticket Software — Digital Work Order Tags | ClaimTagX",
    seoDescription:
      "Replace paper repair tickets with digital tags. Photo-documented intake, condition proof, customer notifications, verified pickup. Built for jewelers, cobblers & electronics repair.",
    headline0: "Every item documented,",
    headline1: "drop-off to pickup.",
    subhead:
      "A customer’s heirloom watch, wedding ring, or laptop deserves better than a handwritten stub. Photo-documented intake, a digital ticket they can’t lose, and a verified handback.",
    pains: {
      "0": {
        title: '"It wasn’t scratched when I brought it in"',
        description:
          "Condition disputes are the most expensive conversation in repair. Intake photos timestamped before work begins make the before-and-after indisputable.",
      },
      "1": {
        title: "Work orders living on paper",
        description:
          "A stub in a drawer and a tag on a tray is a system that fails the day someone is out sick. Digital tickets keep item, owner, and job status connected.",
      },
      "2": {
        title: 'The "is it ready yet?" phone calls',
        description:
          "Every status call interrupts a repair. A digital ticket gives customers something to check — and you a way to notify them the moment it’s done.",
      },
    },
    steps: {
      "0": {
        title: "Document at drop-off",
        description: "Photos of the item and its condition, notes on the job. The signed ticket is the work order.",
      },
      "1": {
        title: "Customer keeps a living ticket",
        description: "It’s in their messages, not their junk drawer. Lost-stub pickups become a thing of the past.",
      },
      "2": {
        title: "Verify the handback",
        description: "Scan the QR at pickup, match against intake photos, release logged with a full audit trail.",
      },
    },
    roiItemLabel: "Items taken in per day",
    faqs: {
      "0": {
        q: "Can I attach job details to the ticket?",
        a: "Yes — tickets carry configurable fields and notes, so the repair description, quoted price, and promised date live with the item record.",
      },
      "1": {
        q: "What happens with long jobs — weeks in the shop?",
        a: "The ticket has no expiry. The customer keeps their link, you keep the custody record, and the audit trail spans the whole job regardless of duration.",
      },
      "2": {
        q: "Is this overkill for a small shop?",
        a: "The free plan covers a single station, and Basic is $30/month — about one prevented dispute per year. Most small shops start free and upgrade when volume grows.",
      },
    },
    ctaHeadline: "Their valuables. Your reputation. Documented.",
    channelNote: 'Status updates reach customers automatically — fewer "is it ready?" calls.',
  },
  hotels: {
    name: "Hotels & Resorts",
    audience: "hotel GMs, front-office managers, and resort operations teams",
    audienceLead: "hotel GMs",
    seoTitle: "Hotel Custody Software — Valet, Luggage & Cloakroom Tickets | ClaimTagX",
    seoDescription:
      "One platform for hotel valet, bag storage, and cloakroom. Digital claim tickets with photo proof and a verified custody record across every station. No guest app. Free plan.",
    headline0: "Valet. Luggage. Cloakroom.",
    headline1: "One system. Zero paper.",
    subhead:
      "Your property runs three custody operations on three flavors of paper — each with its own gaps, and none talking to the others. ClaimTagX replaces all of them with one custody record per guest, delivered however your guests prefer.",
    pains: {
      "0": {
        title: "Three systems, three failure modes",
        description:
          "A valet stub, a bag tag, and a coat check ticket — three paper trails, zero shared visibility. When a guest item goes missing, you don’t even know which system failed. One platform closes all three gaps at once.",
      },
      "1": {
        title: "The five-star review dies at checkout",
        description:
          "A flawless stay ends with a fifteen-minute bag hunt at the bell desk during checkout rush. The last impression is the review. Digital tickets show exactly where every bag, car, and coat is — before the guest reaches the desk.",
      },
      "2": {
        title: "Liability at every touchpoint",
        description:
          "A VIP’s car, designer luggage, a fur in the cloakroom — high-value custody with nothing but a numbered stub behind it. Photo proof at intake and a timestamped custody chain turn every dispute into a thirty-second lookup.",
      },
    },
    steps: {
      "0": {
        title: "Tag anything, at any station",
        description:
          "Valet podium, bell desk, cloakroom — every station issues photo-backed digital tickets from a phone in seconds.",
      },
      "1": {
        title: "One ticket on the guest’s phone",
        description: "Delivered by text, WhatsApp, or email. International guests need no local SIM, no app, no account.",
      },
      "2": {
        title: "Scan to return, anywhere on property",
        description: "Cross-station transfers stay logged. The custody chain closes cleanly — car, bags, and coat included.",
      },
    },
    roiItemLabel: "Items in custody per day (cars, bags, coats)",
    faqs: {
      "0": {
        q: "Can one system really run valet, luggage, and the cloakroom?",
        a: "Yes — each desk is a station on the same platform, with per-station configuration on higher tiers. The Essential plan covers up to five stations, which handles most properties’ valet, bell desk, and cloakroom with room to spare.",
      },
      "1": {
        q: "What about international guests without local numbers?",
        a: "Tickets deliver over WhatsApp and email as well as SMS, and open in any phone browser worldwide. No app store, no local SIM, no account.",
      },
      "2": {
        q: "Can it connect to our property systems?",
        a: "Advanced and Enterprise tiers include API access for property-system integrations, and Enterprise supports white-label and on-prem deployment. Talk to sales about your stack.",
      },
    },
    ctaHeadline: "Every guest touchpoint, accounted for.",
    channelNote: "WhatsApp and email reach international guests; NFC fits the podium and bell desk.",
  },
  airlines: {
    name: "Airlines & Ground Handling",
    audience: "airlines, ground handlers, and airport baggage operations",
    audienceLead: "airlines",
    seoTitle: "Airline Baggage Custody Software — Digital Bag Tags & Chain of Custody | ClaimTagX",
    seoDescription:
      "Digital custody records for gate-checked bags, transfers, and ground handling. Photo condition proof, timestamped handoffs, offline-first on the ramp. Enterprise-grade deployment.",
    headline0: "Mishandled bags cost millions.",
    headline1: "Proof costs cents.",
    subhead:
      "Gate checks, ramp transfers, delayed-bag handling — every handoff is a liability gap on paper. ClaimTagX puts a custody record behind every bag: photo condition proof at intake, timestamped transfers, and offline-first operation airside.",
    pains: {
      "0": {
        title: "The transfer black hole",
        description:
          "A bag changes hands six times between gate and carousel. When it goes missing, nobody can say where custody broke. Timestamped, attributed handoffs make the chain visible end to end.",
      },
      "1": {
        title: "Compensation without evidence",
        description:
          'Damage claims get paid because intake condition can’t be proven. Photo proof at the gate or counter turns "it was damaged in transit" into a documented before-and-after.',
      },
      "2": {
        title: "Gate-check chaos at boarding",
        description:
          "Jet-bridge gate checks happen at maximum time pressure on paper stubs. Sub-2-second digital intake keeps boarding moving while every bag still gets a record.",
      },
    },
    steps: {
      "0": {
        title: "Tag at the gate or counter",
        description: "Photo and condition captured in under 2 seconds — fast enough for boarding pressure.",
      },
      "1": {
        title: "Every transfer logged",
        description: "Ramp, transfer point, arrival — each handoff timestamped and attributed, fully offline-capable airside.",
      },
      "2": {
        title: "Verified return",
        description: "Passenger QR at the carousel or service desk; biometric validation available on Enterprise.",
      },
    },
    roiItemLabel: "Bags handled per day",
    faqs: {
      "0": {
        q: "Can it operate at airport scale?",
        a: "The Enterprise tier is built for it: unlimited stations, staff, and tickets, multi-region and sovereign deployment options, and cloud or on-prem hosting.",
      },
      "1": {
        q: "Does it work airside with no connectivity?",
        a: "Yes — ClaimTagX is offline-first. Ramp teams issue and log handoffs with zero signal; everything syncs the moment connectivity returns.",
      },
      "2": {
        q: "How does procurement and security review work?",
        a: "Enterprise engagements run through our sales team: security documentation, a Data Processing Addendum, white-label options, and deployment planning for your environment.",
      },
    },
    ctaHeadline: "Close the custody gap, gate to carousel.",
    channelNote: "In-app push integrates with your passenger app; biometric validation available on Enterprise.",
    primaryCtaLabel: "Talk to sales",
  },
  "clubs-restaurants": {
    name: "Clubs & Restaurants",
    audience: "nightclubs, fine dining, lounges, and event venues",
    audienceLead: "nightclubs",
    seoTitle: "Coat Check & Valet Software for Clubs & Restaurants | ClaimTagX",
    seoDescription:
      "Digital coat check and valet tickets for nightclubs, restaurants, and lounges. Photo proof, lost-ticket lookup, one scan to return. No guest app. Free plan.",
    headline0: "Coat check. Valet. VIP storage.",
    headline1: "One system for the whole night.",
    subhead:
      "Your night runs on custody — coats at the door, cars at the curb, bags behind the bar. Every one of them on a paper stub your guest will lose by midnight. ClaimTagX puts the ticket on their phone and the record on yours.",
    pains: {
      "0": {
        title: "The closing-time crush",
        description:
          "Fifty coats reclaimed in twenty minutes, by guests who are tired, loud, and ticketless. Lookup by name or phone clears the line — no stub required, no arguments at the door.",
      },
      "1": {
        title: "Paper doesn’t survive a night out",
        description:
          "Tickets dissolve on dance floors, dressing rooms, and taxi seats. A digital ticket lives in the guest’s messages — it leaves when they do, and never before.",
      },
      "2": {
        title: "Designer items, house liability",
        description:
          'The coat rail holds more value than the till. Photo proof at check-in and a verified return mean "that’s not my coat" and "mine was damaged" get answered with evidence, not comps.',
      },
    },
    steps: {
      "0": {
        title: "Check items at the door",
        description: "Coat, bag, or keys — photo snapped, digital ticket issued in under 2 seconds, even at peak entry.",
      },
      "1": {
        title: "The ticket rides in their pocket",
        description: "Sent by text or WhatsApp. No stub to lose between the door and last call.",
      },
      "2": {
        title: "Scan — or look up — to return",
        description: "QR scan for most guests; instant name or phone lookup for the ones who lost everything but their phone.",
      },
    },
    roiItemLabel: "Items checked per night",
    faqs: {
      "0": {
        q: "Is it fast enough for the closing rush?",
        a: "Returns are one scan, and ticketless guests take seconds with name or phone lookup. Most venues find closing moves faster than with paper, because nobody is digging through a numbered rail for a guest with no stub.",
      },
      "1": {
        q: "What if a guest’s phone is dead at 2 AM?",
        a: "Staff look the ticket up by name or phone number and verify against the intake photo. The record is on your side, not just theirs.",
      },
      "2": {
        q: "Does it work for one-off events and pop-ups?",
        a: "There’s no hardware — a coat check can run from a staff phone in 60 seconds. Spin up a station for a single event, then let it sit idle at no extra cost.",
      },
    },
    ctaHeadline: "Run the night. Keep the record.",
    channelNote: "SMS and WhatsApp tickets survive the night better than any paper stub.",
  },
  "beach-clubs": {
    name: "Beach Clubs",
    audience: "beach clubs, pool clubs, and resort day operations",
    audienceLead: "beach clubs",
    seoTitle: "Beach Club Custody Software — Valuables, Gear & Cabana Storage | ClaimTagX",
    seoDescription:
      "Digital custody tickets for beach and pool clubs — valuables at the towel desk, water-sports gear, cabana storage, valet. Photo proof, no app, works in the sun. Free plan.",
    headline0: "Barefoot guests.",
    headline1: "Bulletproof custody.",
    subhead:
      "Phones, watches, and bags at the towel desk. Gear going in and out all day. Cars at the gate. Paper tickets don’t survive a pool day — and your guests’ valuables deserve better than a soggy stub.",
    pains: {
      "0": {
        title: "Paper doesn’t swim",
        description:
          "Wet hands, sunscreen, and sea spray destroy paper tickets by noon. A digital ticket lives on the guest’s phone — waterproof by definition, and recoverable by name even if the phone stays in the locker.",
      },
      "1": {
        title: "High-value handovers, all day long",
        description:
          "Watches, phones, and wallets cross the towel desk every hour. Photo-documented intake and verified return protect the guest’s valuables — and your staff from accusations.",
      },
      "2": {
        title: "Gear that never comes back",
        description:
          "Paddleboards, snorkel sets, cabana equipment — constant churn, zero tracking. Tag the gear, and every checkout has a name, a time, and a return record.",
      },
    },
    steps: {
      "0": {
        title: "Check in valuables or gear",
        description: "Photo, ticket, done — at the towel desk, the gear shack, or the valet gate.",
      },
      "1": {
        title: "The ticket waits on their phone",
        description: "Delivered by WhatsApp, text, or email. It survives the pool even when paper wouldn’t.",
      },
      "2": {
        title: "Verified return, even sandy-handed",
        description: "One scan — or a name lookup — releases the item. Every handoff logged across every station.",
      },
    },
    roiItemLabel: "Items checked per day",
    faqs: {
      "0": {
        q: "We’re seasonal — does that work pricing-wise?",
        a: "Plans are monthly with no hardware investment, so you can scale up for the season and drop to the free tier in the off-months. Nothing to uninstall, nothing wasted.",
      },
      "1": {
        q: "Can one setup cover the towel desk, gear shack, and valet?",
        a: "Yes — each is a station on the same platform. The Essential plan covers five stations, and every item shows up in one custody record per guest.",
      },
      "2": {
        q: "What about guests who lock their phone away?",
        a: "Staff look up any ticket by name or phone number and verify against the intake photo. The custody record lives on your side — the guest’s phone is a convenience, not a requirement.",
      },
    },
    ctaHeadline: "Every towel, watch, and board — accounted for.",
    channelNote: "WhatsApp-first delivery suits international day guests; NFC wristbands fit the gate.",
  },
};
