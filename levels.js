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
    x: 800,
    photo: "photos/0_dating.jpg",
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
    x: 2000,
    photo: "photos/1_graduation.jpg",
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
    x: 3200,
    photo: "photos/2_mochi.jpg",
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
    x: 4400,
    photo: "photos/5_first_home.jpg",
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
    x: 5600,
    photo: "photos/3_engagement.jpg",
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
    x: 6800,
    photo: "photos/4_wedding.jpg",
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
    x: 8000,
    photo: "photos/6_preston.jpg",
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
    x: 9200,
    photo: "photos/7_second_home.jpg",
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
    x: 10400,
    photo: "photos/8_blaire.jpg",
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
    x: 11600,
    photo: "photos/9_camping.jpg",
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
    x: 12800,
    photo: "photos/10_fuji.jpg",
    skyGradient: {
      top: "#ff7e5f",
      bottom: "#feb47b"
    },
    groundColor: "#32531d",
    dialogue: [
      "The Ultimate Journey! 🗻🌸",
      "Look! Mt. Fuji standing beautiful against the sunrise.",
      "The four of us, Preston, Blaire, Mochi, and us, standing together in Japan.",
      "Happy Birthday, Ellen! Here's to making many more memories, together."
    ],
    quiz: {
      question: "What is the final iconic destination that the family goes to see together at the end of the game?",
      options: ["Grand Canyon", "Mt. Fuji", "Eiffel Tower", "Disneyland"],
      answer: "Mt. Fuji"
    }
  }
];
