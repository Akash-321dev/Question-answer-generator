export interface SampleDocument {
  id: string;
  title: string;
  filename: string;
  category: string;
  totalPages: number;
  description: string;
  content: string;
  topics: string[];
  presetQuestions: {
    MCQ: Array<{
      question: string;
      difficulty: 'Easy' | 'Medium' | 'Hard';
      topicTag: string;
      options: string[];
      correctAnswer: string;
      explanation: string;
    }>;
    'Short Answer': Array<{
      question: string;
      difficulty: 'Easy' | 'Medium' | 'Hard';
      topicTag: string;
      correctAnswer: string;
      explanation: string;
    }>;
    'Long Answer': Array<{
      question: string;
      difficulty: 'Easy' | 'Medium' | 'Hard';
      topicTag: string;
      correctAnswer: string;
      explanation: string;
    }>;
    Viva: Array<{
      question: string;
      difficulty: 'Easy' | 'Medium' | 'Hard';
      topicTag: string;
      correctAnswer: string;
      explanation: string;
    }>;
  };
}

export const SAMPLE_MATERIALS: SampleDocument[] = [
  {
    id: 'doc-os-101',
    title: 'Operating Systems: Concurrency & Synchronization',
    filename: 'Operating_Systems_Concurrency_Notes.pdf',
    category: 'Computer Science',
    totalPages: 12,
    description: 'Covers race conditions, critical section problem, mutex locks, semaphores, and Coffman deadlock conditions.',
    topics: ['Process Synchronization', 'Critical Section', 'Semaphores & Mutex', 'Deadlocks & Coffman Conditions'],
    content: `Chapter 5: Process Synchronization and Deadlocks
A race condition occurs when multiple processes access and manipulate the same data concurrently and the outcome depends on the particular order in which access takes place. To prevent race conditions, concurrent processes must be synchronized.
The Critical Section Problem requires three conditions: Mutual Exclusion, Progress, and Bounded Waiting.
Mutex locks and counting semaphores are fundamental synchronization primitives.
A Deadlock situation can arise if four Coffman conditions hold simultaneously: Mutual Exclusion, Hold and Wait, No Preemption, and Circular Wait. Deadlock prevention strategies include resource ordering to eliminate circular wait.`,
    presetQuestions: {
      MCQ: [
        {
          question: 'Which of the following is NOT one of the four Coffman conditions necessary for a deadlock to occur?',
          difficulty: 'Medium',
          topicTag: 'Deadlocks & Coffman Conditions',
          options: [
            'A) Mutual Exclusion',
            'B) Hold and Wait',
            'C) Preemptive Resource Scheduling',
            'D) Circular Wait',
          ],
          correctAnswer: 'C) Preemptive Resource Scheduling',
          explanation: 'Deadlock requires "No Preemption". If preemptive scheduling is allowed, the operating system can seize resources to break the deadlock cycle.',
        },
        {
          question: 'What is the primary purpose of guaranteeing "Bounded Waiting" in solving the Critical Section problem?',
          difficulty: 'Easy',
          topicTag: 'Critical Section',
          options: [
            'A) To maximize processor clock speed',
            'B) To prevent starvation by ensuring a limit on how many times other processes can enter their critical section first',
            'C) To allow unlimited processes inside the critical section simultaneously',
            'D) To encrypt shared memory buffers',
          ],
          correctAnswer: 'B) To prevent starvation by ensuring a limit on how many times other processes can enter their critical section first',
          explanation: 'Bounded waiting ensures that after a process requests entry, there is an upper bound on how many other processes can precede it, preventing indefinite starvation.',
        },
        {
          question: 'How does a counting semaphore differ from a binary mutex lock?',
          difficulty: 'Medium',
          topicTag: 'Semaphores & Mutex',
          options: [
            'A) A counting semaphore can take any non-negative integer value representing available resource instances',
            'B) Counting semaphores can only be used on 64-bit systems',
            'C) Mutex locks allow multiple threads in the critical section concurrently',
            'D) Counting semaphores automatically detect deadlocks using graph analysis',
          ],
          correctAnswer: 'A) A counting semaphore can take any non-negative integer value representing available resource instances',
          explanation: 'A counting semaphore maintains a counter of available identical resource units, whereas a binary mutex takes only 0 or 1 for single-unit mutual exclusion.',
        },
        {
          question: 'Which prevention technique effectively eliminates the Circular Wait condition in deadlock mitigation?',
          difficulty: 'Hard',
          topicTag: 'Deadlocks & Coffman Conditions',
          options: [
            'A) Imposing a global strict linear ordering of all resource types and requiring monotonic acquisition',
            'B) Allocating CPU cores exclusively using round-robin scheduling',
            'C) Using virtual memory page tables with LRU replacement',
            'D) Disabling all hardware interrupts',
          ],
          correctAnswer: 'A) Imposing a global strict linear ordering of all resource types and requiring monotonic acquisition',
          explanation: 'Assigning a unique natural integer index to every resource type and requiring processes to acquire resources in strictly increasing numerical order mathematically prevents circular dependency cycles.',
        },
        {
          question: 'What defines a Race Condition in concurrent programming?',
          difficulty: 'Easy',
          topicTag: 'Process Synchronization',
          options: [
            'A) When two algorithms race to complete first on different GPUs',
            'B) An unpredictable output state resulting from concurrent shared-state modification without synchronization',
            'C) A memory leak that consumes cache buffers',
            'D) When a thread blocks waiting for disk I/O',
          ],
          correctAnswer: 'B) An unpredictable output state resulting from concurrent shared-state modification without synchronization',
          explanation: 'A race condition arises when the final program state depends on the arbitrary interleaving of thread execution order over un-synchronized shared memory.',
        },
      ],
      'Short Answer': [
        {
          question: 'Explain the three mandatory requirements that any valid solution to the Critical Section problem must satisfy.',
          difficulty: 'Medium',
          topicTag: 'Critical Section',
          correctAnswer: 'Mutual Exclusion (only one process in critical section at a time), Progress (only processes competing for entry decide who enters next), and Bounded Waiting (finite limit on delays to prevent starvation).',
          explanation: 'Mutual exclusion prevents memory corruption, progress ensures decisions cannot be postponed indefinitely, and bounded waiting prevents process starvation.',
        },
        {
          question: 'Describe how the "Hold and Wait" condition contributes to deadlock and how an OS can prevent it.',
          difficulty: 'Medium',
          topicTag: 'Deadlocks & Coffman Conditions',
          correctAnswer: 'A process holds at least one resource while waiting for another. Prevention requires requesting all resources upfront simultaneously before execution, or releasing all held resources before requesting new ones.',
          explanation: 'Preventing hold-and-wait eliminates the ability of a process to freeze partial progress while demanding additional contended resources.',
        },
      ],
      'Long Answer': [
        {
          question: 'Contrast Deadlock Prevention, Deadlock Avoidance (e.g., Bankers Algorithm), and Deadlock Detection/Recovery. Analyze trade-offs in resource utilization and overhead.',
          difficulty: 'Hard',
          topicTag: 'Deadlocks & Coffman Conditions',
          correctAnswer: 'Prevention negates one of the 4 Coffman conditions statically (low utilization). Avoidance uses dynamic state evaluation (safe state matrices in Bankers algorithm, requires advance maximum resource knowledge). Detection allows deadlock to occur, periodically analyzes wait-for graphs, and recovers via process termination or resource preemption.',
          explanation: 'Prevention is restrictive; avoidance requires clairvoyance of maximum future needs; detection offers highest runtime throughput but incurs termination penalties.',
        },
      ],
      Viva: [
        {
          question: 'If you have two threads that both need to acquire Mutex A and Mutex B, what subtle code ordering bug will guarantee a deadlock, and how would you prove your fix prevents it?',
          difficulty: 'Hard',
          topicTag: 'Deadlocks & Coffman Conditions',
          correctAnswer: 'Acquiring in opposite orders (Thread 1: A then B; Thread 2: B then A) causes deadlock if Thread 1 gets A while Thread 2 gets B. The fix enforces a uniform lock hierarchy where both threads must always acquire A before B.',
          explanation: 'Proving total order on locks constructs a directed acyclic graph (DAG) of dependencies, where cycles are mathematically impossible.',
        },
      ],
    },
  },
  {
    id: 'doc-ai-201',
    title: 'Deep Learning: Backpropagation & Transformers',
    filename: 'Deep_Learning_Architectures.pdf',
    category: 'Artificial Intelligence',
    totalPages: 16,
    description: 'Covers gradient descent, backpropagation algorithm, vanishing gradients, self-attention, and transformer encoders.',
    topics: ['Backpropagation & Gradients', 'Activation Functions', 'Self-Attention Mechanism', 'Transformer Architecture'],
    content: `Deep Neural Networks learn through gradient-based optimization.
The Backpropagation algorithm uses the calculus Chain Rule to compute partial derivatives of the loss function with respect to every weight in the network.
Saturating activation functions like Sigmoid suffer from the Vanishing Gradient problem, leading to the adoption of ReLU, GELU, and Residual connections.
The Transformer architecture replaces recurrence with Scaled Dot-Product Attention: Attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) * V.
Multi-Head Attention projects Queries, Keys, and Values into multiple representation subspaces.`,
    presetQuestions: {
      MCQ: [
        {
          question: 'In the Scaled Dot-Product Attention formula, what is the mathematical purpose of dividing by sqrt(d_k)?',
          difficulty: 'Hard',
          topicTag: 'Self-Attention Mechanism',
          options: [
            'A) To compress the embedding vector dimension by half',
            'B) To prevent the dot products from growing excessively large for high dimensions, which would push softmax into regions with vanishing gradients',
            'C) To convert query vectors into orthogonal basis vectors',
            'D) To ensure the matrix is symmetric positive definite',
          ],
          correctAnswer: 'B) To prevent the dot products from growing excessively large for high dimensions, which would push softmax into regions with vanishing gradients',
          explanation: 'When d_k is large, the magnitude of the dot products grows, driving softmax toward extreme 0 or 1 outputs with extremely small gradient derivatives.',
        },
        {
          question: 'Why did Rectified Linear Units (ReLU) largely replace Sigmoid activations in deep feedforward networks?',
          difficulty: 'Medium',
          topicTag: 'Activation Functions',
          options: [
            'A) ReLU mitigates vanishing gradients in positive domains because its derivative is a constant 1.0',
            'B) ReLU is strictly bounded between -1 and +1',
            'C) ReLU computes complex trigonometric Fourier transforms',
            'D) ReLU requires no backpropagation to train',
          ],
          correctAnswer: 'A) ReLU mitigates vanishing gradients in positive domains because its derivative is a constant 1.0',
          explanation: 'Sigmoids saturate near 0 and 1 with near-zero derivatives, extinguishing gradient signals across multiple layers. ReLUs have derivative 1 for positive activations.',
        },
        {
          question: 'What fundamental mathematical rule enables the Backpropagation algorithm to propagate errors backward through layers?',
          difficulty: 'Easy',
          topicTag: 'Backpropagation & Gradients',
          options: [
            'A) The Calculus Chain Rule',
            'B) Bayes Theorem',
            'C) Central Limit Theorem',
            'D) De Morgans Law',
          ],
          correctAnswer: 'A) The Calculus Chain Rule',
          explanation: 'Backpropagation applies the multivariate chain rule recursively to compute dLoss/dWeight across stacked composite linear and non-linear transformations.',
        },
      ],
      'Short Answer': [
        {
          question: 'Explain why Residual (Skip) Connections are vital for training very deep networks (e.g. ResNet, Transformers).',
          difficulty: 'Medium',
          topicTag: 'Transformer Architecture',
          correctAnswer: 'Residual connections allow gradients to flow directly through the identity mapping (x + F(x)) without attenuation, preventing vanishing gradients and allowing seamless training of hundreds of layers.',
          explanation: 'The identity shortcut guarantees that earlier layers receive substantial gradient signal even if intermediate weight layers have near-zero gradient.',
        },
      ],
      'Long Answer': [
        {
          question: 'Detail the step-by-step matrix computations involved in Multi-Head Self-Attention for an input sequence of length T and embedding dimension D.',
          difficulty: 'Hard',
          topicTag: 'Self-Attention Mechanism',
          correctAnswer: '1. Project input X into Q, K, V using learnable weights W_Q, W_K, W_V. 2. Split into h heads of dimension d_k = D/h. 3. For each head, compute attention scores Softmax((Q K^T) / sqrt(d_k)). 4. Multiply scores by V to obtain head outputs. 5. Concatenate all h heads and project back through linear matrix W_O.',
          explanation: 'Allows the model to jointly attend to information from different representation subspaces at different positions.',
        },
      ],
      Viva: [
        {
          question: 'Why is Positional Encoding strictly necessary in Transformers, whereas traditional Recurrent Neural Networks (RNNs) needed no explicit positional markers?',
          difficulty: 'Hard',
          topicTag: 'Transformer Architecture',
          correctAnswer: 'Self-attention is permutation-invariant: scrambling the order of input tokens yields the exact same attention outputs without positional tags. RNNs process tokens sequentially one by one, inherently encoding order into their hidden state transitions.',
          explanation: 'Without positional encoding, a transformer treats "dog bites man" identically to "man bites dog".',
        },
      ],
    },
  },
];
