import React, { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { Link } from 'react-router-dom';

export default function SearchOverlay({ games, onClose }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const filtered = query.length > 0
    ? games.filter(g => g.title.toLowerCase().includes(query.toLowerCase())).slice(0, 12)
    : [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-xl"
    >
      <div className="max-w-2xl mx-auto px-4 pt-24">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search games..."
            className="pl-14 pr-14 h-16 text-xl font-body bg-card border-2 border-border focus:border-accent rounded-2xl"
          />
          <button
            onClick={onClose}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-muted flex items-center justify-center hover:bg-border transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {filtered.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 bg-card rounded-2xl border border-border overflow-hidden"
          >
            {filtered.map((game) => (
              <Link
                key={game.id}
                to={`/game/${game.slug}`}
                onClick={onClose}
                className="flex items-center gap-4 px-5 py-3 hover:bg-muted transition-colors border-b border-border last:border-0"
              >
                {game.thumbnail_url && (
                  <img src={game.thumbnail_url} alt="" className="w-10 h-10 rounded-lg object-cover" />
                )}
                <div>
                  <p className="font-display font-semibold text-sm">{game.title}</p>
                  {game.category && (
                    <p className="text-xs text-muted-foreground capitalize">{game.category}</p>
                  )}
                </div>
              </Link>
            ))}
          </motion.div>
        )}

        {query.length > 0 && filtered.length === 0 && (
          <p className="text-center text-muted-foreground mt-8 text-lg">
            No games found for "{query}"
          </p>
        )}
      </div>
    </motion.div>
  );
}
