import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Maximize, Minimize, Share2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export default function GamePage() {
  const slug = window.location.pathname.split('/game/')[1];
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { data: games = [], isLoading } = useQuery({
    queryKey: ['games'],
    queryFn: () => base44.entities.Game.list('-created_date', 200),
  });

  const game = games.find(g => g.slug === slug);

  const toggleFullscreen = () => {
    const iframe = document.getElementById('game-iframe');
    if (!iframe) return;
    
    if (!document.fullscreenElement) {
      iframe.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success("Link copied to clipboard!");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen grid-bg p-4">
        <div className="max-w-6xl mx-auto pt-8">
          <Skeleton className="h-8 w-32 mb-6" />
          <Skeleton className="aspect-video rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="min-h-screen grid-bg flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-3xl font-display font-bold text-secondary mb-3">Game not found</h1>
          <p className="text-muted-foreground mb-6">This game doesn't exist or has been removed.</p>
          <Link to="/">
            <Button className="bg-secondary text-secondary-foreground font-display">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Games
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid-bg">
      <div className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm font-medium">Back</span>
          </Link>

          <h1 className="font-display font-bold text-foreground truncate mx-4">
            {game.title}
          </h1>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={handleShare} className="rounded-lg">
              <Share2 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleFullscreen} className="rounded-lg">
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="relative rounded-2xl overflow-hidden border-2 border-border bg-secondary shadow-2xl">
          {game.iframe_url ? (
            <iframe
              id="game-iframe"
              src={game.iframe_url}
              title={game.title}
              className="w-full aspect-video"
              allowFullScreen
              allow="autoplay; fullscreen"
              sandbox="allow-scripts allow-same-origin allow-popups"
            />
          ) : (
            <div className="w-full aspect-video flex items-center justify-center bg-muted">
              <div className="text-center">
                <p className="text-xl font-display font-bold text-muted-foreground">
                  Game URL not available
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  This game hasn't been configured yet.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center gap-3">
          {game.category && (
            <span className="px-3 py-1 rounded-lg bg-accent/10 text-accent-foreground text-xs font-semibold uppercase tracking-wider border border-accent/20">
              {game.category}
            </span>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 pb-16">
        <h2 className="text-lg font-display font-bold text-foreground mb-4 flex items-center gap-2">
          <span className="w-1 h-5 rounded-full bg-primary" />
          More Games
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {games
            .filter(g => g.id !== game.id)
            .slice(0, 6)
            .map((g) => (
              <Link
                key={g.id}
                to={`/game/${g.slug}`}
                className="group block rounded-2xl overflow-hidden bg-card border border-border hover:border-accent transition-all duration-300"
              >
                <div className="aspect-[4/3] overflow-hidden">
                  {g.thumbnail_url ? (
                    <img src={g.thumbnail_url} alt={g.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" loading="lazy" />
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                      <span className="text-2xl font-display font-bold text-muted-foreground/30">{g.title?.[0]}</span>
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <p className="font-display font-semibold text-xs truncate">{g.title}</p>
                </div>
              </Link>
            ))}
        </div>
      </div>
    </div>
  );
}
