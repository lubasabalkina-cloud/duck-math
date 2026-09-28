import React from 'react';
import { Button } from '@/components/ui/button';

export default function UserNotRegisteredError() {
  return (
    <div className="min-h-screen grid-bg flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <h1 className="text-3xl font-display font-bold text-secondary mb-3">Access restricted</h1>
        <p className="text-muted-foreground mb-6">
          This account is not registered for access to the app.
        </p>
        <Button className="bg-secondary text-secondary-foreground font-display">
          Contact support
        </Button>
      </div>
    </div>
  );
}
