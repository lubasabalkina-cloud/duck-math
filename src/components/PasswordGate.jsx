import React, { useState, useEffect } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const CORRECT_PASSWORD = "676767";
const STORAGE_KEY = "duckmath_auth";

export default function PasswordGate({ children }) {
  const [password, setPassword] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [error, setError] = useState(false);
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved === "true") setIsUnlocked(true);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (password === CORRECT_PASSWORD) {
      setIsUnlocked(true);
      sessionStorage.setItem(STORAGE_KEY, "true");
    } else {
      setError(true);
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
      setTimeout(() => setError(false), 2000);
    }
  };

  if (isUnlocked) return children;

  return (
    <div className="min-h-screen grid-bg flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-10">
          <motion.div
            className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-secondary mb-6"
            animate={{ rotate: [0, -5, 5, 0] }}
            transition={{ duration: 3, repeat: Infinity, repeatDelay: 2 }}
          >
            <span className="text-4xl font-display font-bold text-primary">D</span>
          </motion.div>
          <h1 className="text-4xl font-display font-bold text-secondary tracking-tight">
            Duck Math
          </h1>
          <p className="text-muted-foreground mt-2 font-body text-lg">
            Enter the access code to continue
          </p>
        </div>

        <motion.form
          onSubmit={handleSubmit}
          animate={shaking ? { x: [-10, 10, -10, 10, 0] } : {}}
          transition={{ duration: 0.4 }}
          className="space-y-4"
        >
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              type="password"
              placeholder="Access code"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-12 h-14 text-lg font-body bg-card border-2 border-border focus:border-primary rounded-xl tracking-[0.3em] text-center"
              autoFocus
            />
          </div>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-destructive text-sm text-center font-medium"
              >
                Incorrect code. Try again.
              </motion.p>
            )}
          </AnimatePresence>

          <Button
            type="submit"
            className="w-full h-14 text-lg font-display font-semibold bg-secondary hover:bg-secondary/90 text-secondary-foreground rounded-xl"
          >
            Enter
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
        </motion.form>

        <div className="mt-8 flex justify-center gap-3">
          {[...Array(3)].map((_, i) => (
            <motion.div
              key={i}
              className="w-2 h-2 rounded-full bg-primary"
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 1.5, delay: i * 0.2, repeat: Infinity }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}
