import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dumbbell, Target, MessageSquare, FileText } from 'lucide-react';

export default function Landing() {
  const navigate = useNavigate();

  const features = [
    {
      icon: Target,
      title: 'Lift-Specific Analysis',
      description: 'Focused diagnostic for compound movements like bench, squat, and deadlift'
    },
    {
      icon: MessageSquare,
      title: 'AI-Powered Interview',
      description: 'Smart questions to identify your exact sticking points and limiters'
    },
    {
      icon: FileText,
      title: 'Personalized Program',
      description: 'Get targeted accessories and progression rules based on your diagnosis'
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="inline-block mb-6"
          >
            <Dumbbell className="w-20 h-20 text-primary mx-auto" />
          </motion.div>
          
          <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-600">
            Lift Coach
          </h1>
          
          <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Turn <span className="text-foreground font-semibold">"I'm stuck on my bench"</span> into a{' '}
            <span className="text-primary font-semibold">clear diagnosis + targeted accessories</span>
          </p>
          
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            <Button
              size="lg"
              onClick={() => navigate('/select')}
              className="text-lg px-8 py-6 rounded-full shadow-lg hover:shadow-xl transition-shadow"
            >
              Start Your Diagnosis
            </Button>
          </motion.div>
        </motion.div>

        {/* Features Grid */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto mb-16"
        >
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 + index * 0.1 }}
              className="bg-card p-6 rounded-lg border shadow-sm hover:shadow-md transition-shadow"
            >
              <feature.icon className="w-12 h-12 text-primary mb-4" />
              <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
              <p className="text-muted-foreground">{feature.description}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* How It Works */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="max-w-3xl mx-auto"
        >
          <h2 className="text-3xl font-bold text-center mb-8">How It Works</h2>
          
          <div className="space-y-6">
            {[
              { step: 1, title: 'Select Your Lift', desc: 'Choose the compound movement you want to improve' },
              { step: 2, title: 'Enter Your Profile', desc: 'Share your training background and current strength levels' },
              { step: 3, title: 'Diagnostic Interview', desc: 'Answer 4-8 smart questions about your sticking points' },
              { step: 4, title: 'Get Your Plan', desc: 'Receive a personalized program with targeted accessories' }
            ].map((item, index) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1 + index * 0.1 }}
                className="flex items-start gap-4 bg-card p-4 rounded-lg border"
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                  {item.step}
                </div>
                <div>
                  <h4 className="font-semibold text-lg mb-1">{item.title}</h4>
                  <p className="text-muted-foreground">{item.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Footer */}
      <footer className="border-t py-8 mt-16">
        <div className="container mx-auto px-4 text-center text-muted-foreground">
          <p>Lift Coach MVP - AI-Powered Strength Training Diagnostics</p>
        </div>
      </footer>
    </div>
  );
}
