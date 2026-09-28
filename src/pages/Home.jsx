import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import SiteNav from '../components/SiteNav';
import SearchOverlay from '../components/SearchOverlay';
import GameCard from '../components/GameCard';
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const [searchOpen, setSearchOpen] = useState(false);

  const { data: games = [], isLoading } = useQuery({
    queryKey: ['games'],
    queryFn: () => base44.entities.Game.list('-created_date', 200),
  });

  const urlParams = new URLSearchParams(window.location.search);
  const activeCategory = urlParams.get('cat') || 'all';

  const filteredGames = useMemo(() => {
    if (activeCategory === 'all') return games;
    return games.filter(g => g.category === activeCategory);
  }, [games, activeCategory]);

  const featuredGames = useMemo(() => {
    return games.filter(g => g.featured).slice(0, 4);
  }, [games]);

  return (
    <div className="min-h-screen grid-bg">
      <SiteNav onSearchToggle={() => setSearchOpen(true)} />

      <AnimatePresence>
        {searchOpen && (
          <SearchOverlay games={games} onClose={() => setSearchOpen(false)} />
        )}
      </AnimatePresence>

      <section className="relative overflow-hidden py-16 sm:py-24 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 mb-6">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-sm font-medium text-foreground">
              {games.length} games available
            </span>
          </div>
          <h1 className="text-5xl sm:text-7xl font-display font-bold text-secondary tracking-tight leading-[0.95]">
            Duck Math
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground mt-4 max-w-lg mx-auto font-body leading-relaxed">
            Your gateway to the best online games. Pick a game and start playing instantly.
          </p>
        </div>
      </section>

      {featuredGames.length > 0 && activeCategory === 'all' && (
        <section className="px-4 pb-12">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-lg font-display font-bold text-foreground mb-4 flex items-center gap-2">
              <span className="w-1 h-5 rounded-full bg-primary" />
              Featured
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {featuredGames.map((game, i) => (
                <GameCard key={game.id} game={game} index={i} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="px-4 pb-20">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-lg font-display font-bold text-foreground mb-4 flex items-center gap-2">
            <span className="w-1 h-5 rounded-full bg-accent" />
            {activeCategory === 'all' ? 'All Games' : activeCategory.charAt(0).toUpperCase() + activeCategory.slice(1)}
          </h2>

          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {Array(12).fill(0).map((_, i) => (
                <div key={i} className="rounded-2xl overflow-hidden">
                  <Skeleton className="aspect-[4/3]" />
                  <Skeleton className="h-4 mt-3 mx-3" />
                  <Skeleton className="h-3 mt-1 mx-3 mb-3 w-2/3" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {filteredGames.map((game, i) => (
                <GameCard key={game.id} game={game} index={i} />
              ))}
            </div>
          )}

          {!isLoading && filteredGames.length === 0 && (
            <div className="text-center py-20">
              <p className="text-muted-foreground text-lg">No games found in this category.</p>
            </div>
          )}
        </div>
      </section>

      <footer className="border-t border-border py-8 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-sm text-muted-foreground font-body">
            © {new Date().getFullYear()} Duck Math. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
