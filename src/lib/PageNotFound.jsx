import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function PageNotFound() {
  return (
    <div className="min-h-screen grid-bg flex items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-4xl font-display font-bold text-secondary mb-3">Page not found</h1>
        <p className="text-muted-foreground mb-6">The page you are looking for doesn't exist.</p>
        <Link to="/">
          <Button className="bg-secondary text-secondary-foreground font-display">
            Back to Games
          </Button>
        </Link>
      </div>
    </div>
  );
}
