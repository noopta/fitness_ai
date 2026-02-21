import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Zap } from 'lucide-react';

const STRIPE_URL = 'https://buy.stripe.com/9B614gaQ2gjIdxV26NfUQ01';

interface UpgradePromptProps {
  userId?: string;
}

export function UpgradePrompt({ userId }: UpgradePromptProps) {
  const upgradeUrl = userId
    ? `${STRIPE_URL}?client_reference_id=${userId}`
    : STRIPE_URL;

  return (
    <Card className="p-6 border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
      <div className="flex items-start gap-4">
        <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl border bg-amber-100 dark:bg-amber-900/40">
          <Zap className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-amber-900 dark:text-amber-200">Daily limit reached</h3>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
            You've used your free analyses for today. Upgrade to Pro for unlimited analyses.
          </p>
          <Button
            className="mt-4 bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => window.open(upgradeUrl, '_blank')}
          >
            Upgrade to Pro
            <Zap className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
