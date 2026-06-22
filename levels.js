// Levels/Milestones configuration data
//
// NOTE: `id` is the *scene identity* (drives hurdle/scenery/icon art in assets.js,
// all keyed by id). It is intentionally NOT the same as array position. The array
// ORDER is the chronological walking sequence; `x` spaces the milestones along the
// path. When reordering milestones, keep each one's `id` so its art follows it.
const levelsData = [
  {
    id: 11,
    name: "Started Dating",
    year: "May 2012",
    x: 2000,
    photos: ["photos/barney_ellen_dating.jpg", "photos/IMG_0951.JPG"],
    skyGradient: {
      top: "#ffecd2",
      bottom: "#fcb69f"
    },
    groundColor: "#9ec96f",
    dialogue: [
      "Where it all began 💕",
      "May 2012 — a nervous first date, butterflies, and the very start of our story.",
      "Neither of us knew it yet, but this was step one of a lifelong adventure together."
    ],
    quiz: {
      question: "Which milestone came first in our adventure timeline?",
      options: ["Started dating", "Graduation", "Adopting Mochi", "Our first home"],
      answer: "Started dating"
    }
  },
  {
    id: 1,
    name: "Graduation",
    year: "June 2012",
    x: 3200,
    photos: ["photos/graduation.JPG"],
    skyGradient: {
      top: "#a1c4fd",
      bottom: "#c2e9fb"
    },
    groundColor: "#8bb962",
    dialogue: [
      "Congratulations, Ellen! 🎓",
      "Caps in the air, a degree in hand, and the whole world ahead of you.",
      "This was the launchpad of so many amazing things to come. You made it look easy!"
    ],
    quiz: {
      question: "What did we celebrate in June 2012?",
      options: ["Engagement", "Graduation", "Wedding", "First home"],
      answer: "Graduation"
    }
  },
  {
    id: 2,
    name: "Adopting Mochi",
    year: "July 2012",
    x: 4400,
    photos: ["photos/mochi.JPG", "photos/IMG_2507.jpg"],
    skyGradient: {
      top: "#89f7fe",
      bottom: "#66a6ff"
    },
    groundColor: "#74a54c",
    dialogue: [
      "Welcome home, Mochi! 🐾🐶",
      "Adopting our little white Shih Tzu, Mochi, brought so much joy and endless tail wags.",
      "Our team just got a lot more fluffy and full of love!"
    ],
    quiz: {
      question: "What is the name of our cute white Shih Tzu?",
      options: ["Max", "Mochi", "Milo", "Rocky"],
      answer: "Mochi"
    }
  },
  {
    id: 5,
    name: "Our First Home",
    year: "December 2016",
    x: 5600,
    photos: ["photos/first_home.jpg"],
    skyGradient: {
      top: "#fbc2eb",
      bottom: "#a6c1ee"
    },
    groundColor: "#416726",
    dialogue: [
      "Our First Home! 🔑🏠",
      "Cardboard boxes stacked to the ceiling, eating takeout pizza sitting on the living room floor.",
      "It didn't matter—it was ours, and it quickly filled with warmth and dreams."
    ],
    quiz: {
      question: "What was the landmark milestone we hit in 2016?",
      options: ["Adopting Mochi", "Moving to our 2nd house", "Getting married", "Our first home together"],
      answer: "Our first home together"
    }
  },
  {
    id: 3,
    name: "The Engagement",
    year: "March 2018",
    x: 6800,
    photos: ["photos/proposal.jpg", "photos/DSC_6346.jpg", "photos/IMG_2110.JPG"],
    skyGradient: {
      top: "#fddb92",
      bottom: "#d1fdff"
    },
    groundColor: "#61953d",
    dialogue: [
      "Will you marry me? 💍",
      "My heart was racing, the ring was in my pocket, and the scenery was perfect.",
      "When you smiled and said YES, the future became brighter than ever."
    ],
    quiz: {
      question: "What year did we get engaged?",
      options: ["2016", "2017", "2018", "2019"],
      answer: "2018"
    }
  },
  {
    id: 4,
    name: "Our Wedding Day",
    year: "October 2018",
    x: 8000,
    photos: ["photos/wedding.JPG", "photos/IMG_4496.JPG", "photos/IMG_4500.JPG", "photos/IMG_1633.JPG"],
    skyGradient: {
      top: "#ff9a9e",
      bottom: "#fecfef"
    },
    groundColor: "#4f7a30",
    dialogue: [
      "The Wedding! 🤵👰",
      "Surrounded by family, friends, and Mochi, we danced the night away.",
      "Here's to a lifetime of partnership, laughter, and endless adventure."
    ],
    quiz: {
      question: "We danced under a beautiful sky at our wedding. What year did we tie the knot?",
      options: ["2017", "2018", "2019", "2020"],
      answer: "2018"
    }
  },
  {
    id: 6,
    name: "Welcoming Preston",
    year: "July 2019",
    x: 9200,
    photos: ["photos/ellen_preston.JPG", "photos/AG3_2242.jpg", "photos/IMG_3673.jpg", "photos/IMG_7003.jpg", "photos/IMG_7147.jpg"],
    skyGradient: {
      top: "#b1f2ff",
      bottom: "#a1c4fd"
    },
    groundColor: "#598935",
    dialogue: [
      "Hello, Preston! 🍼👶",
      "Welcoming our baby boy, Preston, into the world in the summer of 2019. Our lives changed forever.",
      "You became a mom, I became a dad, and we fell completely in love with our beautiful boy."
    ],
    quiz: {
      question: "What is the name of our first child, born in 2019?",
      options: ["Peter", "Parker", "Preston", "Patrick"],
      answer: "Preston"
    }
  },
  {
    id: 7,
    name: "Moving to Our Second House",
    year: "October 2020",
    x: 10400,
    photos: ["photos/2nd_home.webp"],
    // Frame the full width of the house, trimming most of the foreground road
    photoCrop: { zoom: 1.35, focusX: 0.03, focusY: 0.18 },
    skyGradient: {
      top: "#30cfd0",
      bottom: "#330867"
    },
    groundColor: "#32531d",
    dialogue: [
      "Onto Next Chapters! 🏡✨",
      "Moving to our second house! More room for Preston to play, and new spaces for Mochi to run.",
      "Packing was tiring, but building our dream house made it all worth it."
    ],
    quiz: {
      question: "What milestone happened directly after welcoming Preston?",
      options: ["Moving to our 2nd house", "Having Blaire", "Going camping with the RV", "Engagement"],
      answer: "Moving to our 2nd house"
    }
  },
  {
    id: 8,
    name: "Welcoming Blaire",
    year: "August 2024",
    x: 11600,
    photos: [
      "photos/ellen_blaire.jpg",
      "photos/D41E430D-92A3-4FAA-91FB-F022EE2C4E7D.JPG",
      "photos/IMG_0123.jpg",
      "photos/IMG_6587.JPG",
      "photos/IMG_6591.JPG",
      "photos/IMG_6641.JPG",
      "photos/IMG_7497.jpg",
      "photos/IMG_9666.jpg",
      "photos/IMG_5171.jpg",
      "photos/IMG_5033.jpg",
      "photos/IMG_9942.jpg"
    ],
    skyGradient: {
      top: "#1a1c4b",
      bottom: "#0f1026"
    },
    groundColor: "#213612",
    dialogue: [
      "Hello, Baby Blaire! 👶🎀",
      "Welcoming our baby girl, Blaire! Preston is officially a big brother, and we are a family of four.",
      "Preston is running around while baby Blaire crawls and giggles. The house is full of life!"
    ],
    quiz: {
      question: "What is the name of our daughter, born in 2024?",
      options: ["Bella", "Blaire", "Bianca", "Brooke"],
      answer: "Blaire"
    }
  },
  {
    id: 9,
    name: "RV Camping Adventures",
    year: "2025",
    x: 12800,
    photos: [
      "photos/airstream_camping.jpg",
      "photos/bean_trailer_camping.jpg",
      "photos/preston_blaire_camping.jpg",
      "photos/IMG_9054.jpg",
      "photos/IMG_4900.jpg",
      "photos/IMG_5006.jpg",
      "photos/IMG_5023.jpg"
    ],
    skyGradient: {
      top: "#0f172a",
      bottom: "#311b5e"
    },
    groundColor: "#1d2e10",
    dialogue: [
      "Hitting the Road! 🚐🌲",
      "Hooking up the RV trailer, packing up the kids, and driving out into nature.",
      "Preston and Blaire are roasting marshmallows, Mochi is chasing squirrels, and we're sleeping under the stars."
    ],
    quiz: {
      question: "What vehicle did we use for our camping adventures in 2025?",
      options: ["An SUV", "A Tent", "An RV Trailer", "A Cabin Cruiser"],
      answer: "An RV Trailer"
    }
  },
  {
    id: 10,
    name: "The Family at Mt. Fuji",
    year: "2026",
    x: 15500,
    photos: ["photos/mt_fuji.jpg", "photos/IMG_2680.JPG", "photos/IMG_2817.jpg"],
    // Shift the floating photos to the upper-right so they don't cover the mountain
    cardDX: 175,
    cardDY: -12,
    skyGradient: {
      top: "#ff7e5f",
      bottom: "#feb47b"
    },
    groundColor: "#32531d",
    dialogue: [
      "The Ultimate Journey! 🗻🌸",
      "Look! Mt. Fuji standing beautiful against the sunrise.",
      "The five of us, Preston, Blaire, Mochi, and us, standing together in Japan.",
      "Happy Birthday, Ellen! Here's to making many more memories, together."
    ],
    quiz: {
      question: "What is the final iconic destination that the family goes to see together at the end of the game?",
      options: ["Grand Canyon", "Mt. Fuji", "Eiffel Tower", "Disneyland"],
      answer: "Mt. Fuji"
    }
  }
];
