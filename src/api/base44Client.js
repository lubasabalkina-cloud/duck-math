const demoGames = [
  {
    id: "1",
    title: "Duck Dash",
    slug: "duck-dash",
    thumbnail_url: "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=900&q=80",
    iframe_url: "https://www.crazygames.com/embed/duck-life",
    category: "action",
    featured: true
  },
  {
    id: "2",
    title: "Pixel Drift",
    slug: "pixel-drift",
    thumbnail_url: "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=900&q=80",
    iframe_url: "https://www.crazygames.com/embed/mini-racer",
    category: "racing",
    featured: true
  },
  {
    id: "3",
    title: "Puzzle Bloom",
    slug: "puzzle-bloom",
    thumbnail_url: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
    iframe_url: "https://www.crazygames.com/embed/color-match",
    category: "puzzle",
    featured: true
  },
  {
    id: "4",
    title: "Skybound",
    slug: "skybound",
    thumbnail_url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=80",
    iframe_url: "https://www.crazygames.com/embed/sky-ride",
    category: "adventure",
    featured: true
  },
  {
    id: "5",
    title: "Goal Rush",
    slug: "goal-rush",
    thumbnail_url: "https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=900&q=80",
    iframe_url: "https://www.crazygames.com/embed/football-stars",
    category: "sports",
    featured: false
  },
  {
    id: "6",
    title: "Castle Logic",
    slug: "castle-logic",
    thumbnail_url: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=80",
    iframe_url: "https://www.crazygames.com/embed/kingdom-tactics",
    category: "strategy",
    featured: false
  },
  {
    id: "7",
    title: "Night Shift",
    slug: "night-shift",
    thumbnail_url: "https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?auto=format&fit=crop&w=900&q=80",
    iframe_url: "https://www.crazygames.com/embed/haunted-escape",
    category: "horror",
    featured: false
  },
  {
    id: "8",
    title: "Neon Bounce",
    slug: "neon-bounce",
    thumbnail_url: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=900&q=80",
    iframe_url: "https://www.crazygames.com/embed/neon-runner",
    category: "arcade",
    featured: false
  },
  {
    id: "9",
    title: "Cave Runner",
    slug: "cave-runner",
    thumbnail_url: "https://images.unsplash.com/photo-1552674605-db6ffd4facb5?auto=format&fit=crop&w=900&q=80",
    iframe_url: "https://www.crazygames.com/embed/cave-adventure",
    category: "adventure",
    featured: false
  },
  {
    id: "10",
    title: "Math Burst",
    slug: "math-burst",
    thumbnail_url: "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=900&q=80",
    iframe_url: "https://www.crazygames.com/embed/math-attack",
    category: "puzzle",
    featured: false
  }
];

export const base44 = {
  entities: {
    Game: {
      list: async (sort = '-created_date', limit = 200) => {
        return demoGames.slice(0, Number(limit) || demoGames.length);
      }
    }
  }
};
