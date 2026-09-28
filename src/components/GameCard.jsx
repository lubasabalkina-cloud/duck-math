import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Play } from 'lucide-react';

export default function GameCard({ game, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.5), duration: 0.4 }}
    >
      <Link
        to={`/game/${game.slug}`}
        className="group block relative rounded-2xl overflow-hidden bg-card border border-border hover:border-accent transition-all duration-300 hover:shadow-lg hover:shadow-accent/10"
      >
        <div className="aspect-[4/3] relative overflow-hidden">
          {game.thumbnail_url ? (
            <img
              src={game.thumbnail_url}
              alt={game.title}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full bg-muted flex items-center justify-center">
              <span className="text-4xl font-display font-bold text-muted-foreground/30">
                {game.title?.[0]}
              </span>
            </div>
          )}
          
          <div className="absolute inset-0 bg-secondary/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
            <motion.div
              className="w-14 h-14 rounded-full bg-primary flex items-center justify-center"
              whileHover={{ scale: 1.1 }}
            >
              <Play className="w-6 h-6 text-primary-foreground ml-0.5" fill="currentColor" />
            </motion.div>
          </div>

          {game.category && (
            <div className="absolute top-2 left-2">
              <span className="px-2 py-0.5 rounded-md bg-secondary/80 text-secondary-foreground text-[10px] font-semibold uppercase tracking-wider backdrop-blur-sm">
                {game.category}
              </span>
            </div>
          )}
        </div>
        
        <div className="p-3">
          <h3 className="font-display font-semibold text-sm text-foreground truncate">
            {game.title}
          </h3>
        </div>
      </Link>
    </motion.div>
  );
}
