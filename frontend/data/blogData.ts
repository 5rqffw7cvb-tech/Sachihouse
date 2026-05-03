export interface BlogPost {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  date: string;
  imageUrl: string;
  category: string;
  isFeatured?: boolean;
}

export const mockBlogPosts: BlogPost[] = [
  {
    id: 'secret-gardens',
    title: 'Finding Stillness in Shinjuku: A Guide to Secret Gardens',
    excerpt: 'Amidst the neon lights and towering skyscrapers of one of Tokyos busiest districts, tranquil oases exist if you know where to look.',
    content: `# Finding Stillness in Shinjuku: A Guide to Secret Gardens\n\nAmidst the neon lights and towering skyscrapers of one of Tokyo's busiest districts, tranquil oases exist if you know where to look.\n\n## Shinjuku Gyoen National Garden\n\nShinjuku Gyoen is one of Tokyo's largest and most popular parks. Located just a short walk from Shinjuku Station, the park's spacious lawns, meandering walking paths and tranquil scenery provide a relaxing escape from the busy urban center around it.\n\n*   **Spring:** Cherry blossoms (Sakura)\n*   **Autumn:** Changing leaves (Koyo)\n*   **Year-round:** Traditional Japanese tea house`,
    date: 'October 12, 2024',
    imageUrl: 'https://images.unsplash.com/photo-1542051841857-5f90071e7989?auto=format&fit=crop&q=80&w=1600',
    category: 'Travel Stories',
    isFeatured: true
  },
  {
    id: 'tokyo-metro',
    title: 'Navigating the Tokyo Metro Like a Local',
    excerpt: 'Master the intricate web of train lines with our comprehensive guide to Suica cards, rush hour etiquette, and essential transit apps.',
    content: `# Navigating the Tokyo Metro Like a Local\n\nMaster the intricate web of train lines with our comprehensive guide to Suica cards, rush hour etiquette, and essential transit apps.\n\n## Getting a Suica or Pasmo\n\nThe first thing you should do when arriving in Tokyo is get a transit IC card. The main ones are Suica and Pasmo. They are functionally identical.\n\nInstead of buying a physical card, you can easily add a digital Suica to your Apple Wallet or Google Pay. Just type "Suica" into your wallet app, add funds with your credit card, and tap your phone at the ticket gates!`,
    date: 'October 05, 2024',
    imageUrl: 'https://images.unsplash.com/photo-1522819777977-cfb5bcf9435b?auto=format&fit=crop&q=80&w=1600',
    category: 'Local Tips'
  },
  {
    id: 'shimokitazawa-izakayas',
    title: 'Top 5 Neighborhood Izakayas in Shimokitazawa',
    excerpt: 'Experience authentic Japanese pub culture in Tokyo\'s coolest bohemian district. We review the best spots for yakitori and craft beer.',
    content: `# Top 5 Neighborhood Izakayas in Shimokitazawa\n\nExperience authentic Japanese pub culture in Tokyo's coolest bohemian district. We review the best spots for yakitori and craft beer.\n\n1.  **Shirubei:** Hidden behind a tiny, unmarked wooden door.\n2.  **Ushitora:** Famous for their extensive craft beer selection.\n3.  **Teppen:** Exceptional grilled fish and energetic staff.\n4.  **Kushimono-ya:** The go-to spot for late-night Yakitori.\n5.  **Bancho:** A cozy, standing-only bar perfect for solo travelers.`,
    date: 'September 28, 2024',
    imageUrl: 'https://images.unsplash.com/photo-1558231221-dbb22ed7019d?auto=format&fit=crop&q=80&w=1600',
    category: 'Dining & Food'
  },
  {
    id: 'best-coffee-shibuya',
    title: 'The Best Coffee Shops for Remote Work in Shibuya',
    excerpt: 'Find the best wifi and artisan roasts in Shibuya. We detail our favorite spots that welcome laptop warriors.',
    content: `# The Best Coffee Shops for Remote Work in Shibuya\n\nFind the best wifi and artisan roasts in Shibuya. We detail our favorite spots that welcome laptop warriors.\n\n## Our Top Picks\n\n*   **Fuglen Tokyo:** A Norwegian cafe by day, cocktail bar by night. Great atmosphere but seating can be tight.\n*   **Blue Bottle Coffee Shibuya:** Spacious and bright with sweeping park views.\n*   **About Life Coffee Brewers:** Strictly for a quick stand-and-sip, but arguably the best espresso pull in the area.`,
    date: 'October 10, 2024',
    imageUrl: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&q=80&w=1600',
    category: 'Local Tips'
  },
  {
    id: 'cherry-blossom-planning',
    title: 'A Guide to Cherry Blossom Season Planning',
    excerpt: 'When and where to see the sakura in full bloom. Tips on avoiding the biggest crowds and finding unique photo spots.',
    content: `# A Guide to Cherry Blossom Season Planning\n\nWhen and where to see the sakura in full bloom. Tips on avoiding the biggest crowds and finding unique photo spots.\n\ntiming is everything. The cherry blossoms (sakura) usually bloom in late March to early April in Tokyo, lasting only about a week or two depending on wind and rain.\n\n## Best Spots\n\n*   **Chidorigafuchi Moat:** Rent a rowboat and drift under the weeping cherry trees.\n*   **Meguro River:** Over 800 cherry trees line this urban canal. Best viewed at night when illuminated.\n*   **Ueno Park:** The most famous (and crowded) spot for Hanami (flower-viewing) parties.`,
    date: 'October 02, 2024',
    imageUrl: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&q=80&w=1600',
    category: 'Culture & Etiquette'
  },
  {
    id: 'akihabara-guide',
    title: 'A Beginner’s Guide to Akihabara: Anime, Electronics, and Beyond',
    excerpt: 'Dive into the electric town of Akihabara. From towering retro arcades to multi-story electronics stores, here is how to tackle the nerd capital of the world.',
    content: `# A Beginner’s Guide to Akihabara: Anime, Electronics, and Beyond\n\nDive into the electric town of Akihabara. From towering retro arcades to multi-story electronics stores, here is how to tackle the nerd capital of the world.\n\n## Must-Visit Spots\n\n*   **Super Potato:** A paradise for retro gaming fans.\n*   **Radio Kaikan:** 10 floors of figures, trading cards, and anime merch.\n*   **Yodobashi Camera:** The massive electronics store right next to the station.`,
    date: 'September 15, 2024',
    imageUrl: 'https://images.unsplash.com/photo-1542051812871-757500b5bb02?auto=format&fit=crop&q=80&w=1600',
    category: 'Travel Stories'
  },
  {
    id: 'tsukiji-outer-market',
    title: 'What to Eat at the Tsukiji Outer Market',
    excerpt: 'The inner wholesale market may have moved to Toyosu, but the Tsukiji Outer Market remains a street food paradise. Here\'s what to eat.',
    content: `# What to Eat at the Tsukiji Outer Market\n\nThe inner wholesale market may have moved to Toyosu, but the Tsukiji Outer Market remains a street food paradise. Here's what to eat.\n\n*   **Tamagoyaki:** Sweet, rolled Japanese omelet served piping hot on a stick.\n*   **Fresh Oysters:** Slurp down giant raw oysters with a squeeze of lemon.\n*   **Strawberry Daifuku:** Mochi stuffed with sweet red bean paste and a fresh strawberry.\n*   **Kaisen Don:** A spectacular bowl of rice topped with fresh, varied sashimi.`,
    date: 'September 08, 2024',
    imageUrl: 'https://images.unsplash.com/photo-1583095123989-1383bd688847?auto=format&fit=crop&q=80&w=1600',
    category: 'Dining & Food'
  },
  {
    id: 'mt-fuji-day-trip',
    title: 'How to Take a Day Trip to Mt. Fuji from Tokyo',
    excerpt: 'Is it worth doing a day trip? Yes, if you plan it right. Here are the best transportation options and viewing spots around Kawaguchiko.',
    content: `# How to Take a Day Trip to Mt. Fuji from Tokyo\n\nIs it worth doing a day trip? Yes, if you plan it right. Here are the best transportation options and viewing spots around Kawaguchiko.\n\n## The Highway Bus\n\nThe easiest and cheapest way to get to Kawaguchiko is by taking a highway bus from the Shinjuku Expressway Bus Terminal. It takes about 2 hours.\n\n## Best Viewing Spots\n\n*   **Oishi Park:** Stunning views of Mt. Fuji across Lake Kawaguchiko.\n*   **Chureito Pagoda:** The classic postcard view (prepare for stairs!)`,
    date: 'August 30, 2024',
    imageUrl: 'https://images.unsplash.com/photo-1490806843957-31f4c9a91c65?auto=format&fit=crop&q=80&w=1600',
    category: 'Travel Stories'
  },
  {
    id: 'onsen-etiquette',
    title: 'The Unwritten Rules of Japanese Onsen (Hot Springs)',
    excerpt: 'Don\'t be intimidated by the communal baths! Follow our step-by-step etiquette guide to enjoy a relaxing soak without making a faux pas.',
    content: `# The Unwritten Rules of Japanese Onsen (Hot Springs)\n\nDon't be intimidated by the communal baths! Follow our step-by-step etiquette guide to enjoy a relaxing soak without making a faux pas.\n\n## The Basic Rules\n\n1.  **Wash Before You Soak:** You must thoroughly wash and rinse your body at the showering stations before entering the bath.\n2.  **No Towels in the Water:** Keep your small modesty towel out of the water. Balance it on your head or leave it on the edge.\n3.  **Tattoos:** Sadly, many onsen still prohibit tattoos. Look for "tattoo-friendly" onsen or book a private bath (kashikiri).`,
    date: 'August 22, 2024',
    imageUrl: 'https://images.unsplash.com/photo-1506506200949-c9cc45fe10dc?auto=format&fit=crop&q=80&w=1600',
    category: 'Culture & Etiquette'
  },
  {
    id: 'asakusa-sensoji',
    title: 'Early Morning at Senso-ji: Beating the Crowds in Asakusa',
    excerpt: 'Tokyo’s oldest temple is magic before the souvenir shops open. Why you should wake up early to experience the history of Asakusa in peace.',
    content: `# Early Morning at Senso-ji: Beating the Crowds in Asakusa\n\nTokyo’s oldest temple is magic before the souvenir shops open. Why you should wake up early to experience the history of Asakusa in peace.\n\n## The Magic Hour\n\nArriving around 6:00 AM means you'll share the temple grounds only with locals taking their morning walk or praying. The massive red lantern at the Kaminarimon gate is much easier to photograph without hundreds of tourists in front of it!\n\nOnce you're done exploring, you can grab a traditional Japanese breakfast nearby as the city wakes up.`,
    date: 'August 10, 2024',
    imageUrl: 'https://images.unsplash.com/photo-1540306154697-75d315cbba2a?auto=format&fit=crop&q=80&w=1600',
    category: 'Travel Stories'
  }
];

export const mockCategories = [
  { name: 'Travel Stories', count: 12 },
  { name: 'Local Tips', count: 8 },
  { name: 'Dining & Food', count: 15 },
  { name: 'Culture & Etiquette', count: 5 }
];
