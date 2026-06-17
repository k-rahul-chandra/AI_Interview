import os
import json
import base64
import tempfile
from openai import OpenAI

# Initialize OpenAI Client if key is available
api_key = os.environ.get("OPENAI_API_KEY")
client = None
if api_key:
    client = OpenAI(api_key=api_key)

PRESETS = {
    "React Developer": {
        "system_prompt": (
            "You are a Senior Frontend Architect conducting a technical interview for a React Developer role. "
            "Evaluate the user's responses for React hooks, state management (Redux, Zustand, Context), rendering performance, "
            "TailwindCSS, component design, and SSR/Next.js. "
            "Ask challenging, realistic questions. Ask exactly ONE clear, concise question at a time. "
            "Do not output any introductory or meta-dialogue. Start directly with the question or follow-up."
        ),
        "first_question": "Let's start the React interview. Can you explain the main differences between `useMemo` and `useCallback`? In what scenarios would you choose to use one over the other?"
    },
    "ML Engineer": {
        "system_prompt": (
            "You are a Principal Machine Learning Engineer conducting a technical interview. "
            "Evaluate responses for ML algorithms (supervised/unsupervised), deep learning architectures (Transformers, CNNs), "
            "model evaluation, overfitting mitigation, LLMs, fine-tuning, and production deployment pipelines. "
            "Ask challenging, realistic questions. Ask exactly ONE clear, concise question at a time. "
            "Do not output any introductory or meta-dialogue. Start directly with the question or follow-up."
        ),
        "first_question": "Let's begin. Can you explain the bias-variance tradeoff? How would you diagnose a model that has high variance, and what strategies would you use to resolve it?"
    },
    "Backend Dev": {
        "system_prompt": (
            "You are a Principal Backend Engineer conducting a technical interview. "
            "Evaluate responses for REST/GraphQL/WebSocket API design, SQL vs. NoSQL databases, caching (Redis), "
            "concurrency, microservices, load balancing, security (OAuth, rate-limiting), and message queues (RabbitMQ/Kafka). "
            "Ask challenging, realistic questions. Ask exactly ONE clear, concise question at a time. "
            "Do not output any introductory or meta-dialogue. Start directly with the question or follow-up."
        ),
        "first_question": "To start, how would you design a distributed rate-limiting system for a public API that handles millions of requests per day? What data stores and algorithms would you use?"
    },
    "Behavioral": {
        "system_prompt": (
            "You are an Engineering Manager conducting a behavioral/HR interview. "
            "Evaluate responses based on the STAR methodology (Situation, Task, Action, Result). "
            "Focus on conflict resolution, leadership, communication, handling failure, time management, and engineering culture. "
            "Ask warm, professional, realistic questions. Ask exactly ONE clear, concise question at a time. "
            "Do not output any introductory or meta-dialogue. Start directly with the question or follow-up."
        ),
        "first_question": "Welcome! Let's start with a behavioral question. Can you tell me about a time when you had a disagreement with a technical decision made by a peer or manager? How did you handle it, and what was the outcome?"
    }
}

class InterviewSession:
    def __init__(self, interview_type: str):
        self.interview_type = interview_type if interview_type in PRESETS else "React Developer"
        self.preset = PRESETS[self.interview_type]
        self.history = []  # List of {"role": "user"/"assistant", "content": "..."}
        self.question_count = 1
        self.max_questions = 6 # conducts 5-7 questions
        self.current_question = self.preset["first_question"]
        
        # Append initial question to history
        self.history.append({"role": "assistant", "content": self.current_question})

    def get_first_question(self) -> str:
        return self.current_question

    def add_user_answer(self, answer_text: str):
        self.history.append({"role": "user", "content": answer_text})

    def generate_next_question(self) -> str:
        self.question_count += 1
        if self.question_count > self.max_questions:
            return "Thank you. We have completed the interview. I am now preparing your detailed feedback report. Please hold on a moment."

        if not client:
            # Mock dynamic question generation when no API Key is present
            return self._generate_mock_question()

        # Real LLM question generation using Chat Completion
        system_prompt = self.preset["system_prompt"]
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "system", "content": f"Context: This is question {self.question_count} of {self.max_questions}. If the user's answer was brief or needs clarification, follow up. Otherwise, transition to a new relevant topic for a {self.interview_type} role. Keep questions conversational and professional."}
        ] + self.history

        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                temperature=0.7,
                max_tokens=150
            )
            next_q = response.choices[0].message.content.strip()
            self.current_question = next_q
            self.history.append({"role": "assistant", "content": next_q})
            return next_q
        except Exception as e:
            print(f"Error generating LLM question: {e}")
            return self._generate_mock_question()

    def generate_feedback_report(self) -> dict:
        transcript = ""
        for msg in self.history:
            role_label = "Interviewer" if msg["role"] == "assistant" else "Candidate"
            transcript += f"{role_label}: {msg['content']}\n\n"

        if not client:
            return self._generate_mock_feedback()

        prompt = (
            f"You are a senior hiring manager and tech lead. Evaluate this candidate transcript for a {self.interview_type} position.\n"
            f"Transcript:\n{transcript}\n\n"
            "Provide a detailed feedback report. Return ONLY a valid JSON object matching this schema. Do not include markdown codeblocks or text outside the JSON:\n"
            "{\n"
            '  "clarity": 1-10 integer,\n'
            '  "technical_depth": 1-10 integer,\n'
            '  "confidence": 1-10 integer,\n'
            '  "summary": "Overall summary paragraph analyzing candidate strengths and weaknesses.",\n'
            '  "suggestions": [\n'
            '    "Suggestion 1: Must be actionable and specific.",\n'
            '    "Suggestion 2: Must be actionable and specific.",\n'
            '    "Suggestion 3: Must be actionable and specific."\n'
            '  ]\n'
            "}"
        )

        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a professional technical recruiter. Output raw JSON only."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.5,
                response_format={"type": "json_object"}
            )
            report_data = json.loads(response.choices[0].message.content.strip())
            return report_data
        except Exception as e:
            print(f"Error generating LLM feedback report: {e}")
            return self._generate_mock_feedback()

    def _generate_mock_question(self) -> str:
        # High quality fallback questions depending on index and interview type
        index = self.question_count
        mocks = {
            "React Developer": [
                "That makes sense. Next, could you explain how the Virtual DOM works and how React 18 concurrent features like startTransition change rendering?",
                "Great. How do you handle complex state management across multiple pages? What is your experience with Redux Toolkit or Zustand vs. React Context?",
                "Let's touch on performance. How do you profile a slow React application, and what steps do you take to optimize it?",
                "Can you discuss your approach to writing CSS? Do you prefer CSS Modules, Styled Components, or TailwindCSS, and why?",
                "Thank you. That completes the questions. Let me generate your feedback report."
            ],
            "ML Engineer": [
                "Understood. Moving on, what is the difference between L1 and L2 regularization? When would you use one over the other, and how do they prevent overfitting?",
                "How do transformer architectures work, specifically the self-attention mechanism? How does it improve on recurrent neural networks?",
                "Suppose you have an imbalanced dataset for a classification task. What techniques (like resampling, synthetic data, or loss adjustments) would you use?",
                "Could you walk me through the lifecycle of deploying an ML model into production? How do you monitor for model and concept drift?",
                "Thank you. That completes the ML engineering questions. Let me compile your feedback report."
            ],
            "Backend Dev": [
                "I see. Next, how do you handle database transactions and ensure ACID compliance across microservices? What is the Saga pattern?",
                "Let's discuss databases. When do you choose a document store like MongoDB over a relational database like PostgreSQL?",
                "How does connection pooling work, and why is it important in high-concurrency environments?",
                "Can you explain JWT-based authentication? What are the security vulnerabilities associated with JWTs and how do you mitigate them?",
                "Thank you. That completes the backend questions. Let me build your feedback report."
            ],
            "Behavioral": [
                "Thank you for sharing that. Can you describe a project that failed or didn't meet expectations? What was your role, what did you learn, and how did you pivot?",
                "Tell me about a time you had to deliver a critical feature on a tight deadline, but you had technical debt or blocker requirements. How did you prioritize?",
                "How do you handle giving and receiving critical feedback, particularly during code reviews or architectural design sessions?",
                "Describe a situation where you had to lead or influence a team decision without formal authority. What was your strategy?",
                "Thank you. That concludes the behavioral questions. Let me synthesize your feedback report."
            ]
        }
        
        list_of_questions = mocks.get(self.interview_type, mocks["React Developer"])
        # select based on index
        idx = min(index - 2, len(list_of_questions) - 1)
        next_q = list_of_questions[idx]
        self.current_question = next_q
        self.history.append({"role": "assistant", "content": next_q})
        return next_q

    def _generate_mock_feedback(self) -> dict:
        # Analyze simple stats of answers to adjust scores
        num_answers = len([h for h in self.history if h["role"] == "user"])
        avg_length = sum(len(h["content"]) for h in self.history if h["role"] == "user") / (num_answers or 1)

        # Standard heuristics to make the scores look reactive:
        clarity = min(10, max(5, int(avg_length / 25) + 3))
        tech = min(10, max(4, int(avg_length / 30) + 2))
        conf = min(10, max(5, int(num_answers) + 2))

        # Preset fallback suggestions based on type
        suggestions = {
            "React Developer": [
                "Dive deeper into React 18 concurrent rendering features like startTransition and useDeferredValue.",
                "Structure state management discussions by comparing context API vs. external store engines (Zustand/Redux).",
                "Mention bundle size optimization techniques, lazy loading, and core web vitals measuring tools."
            ],
            "ML Engineer": [
                "Explain the mathematical intuition behind regularization (L1 sparsity vs L2 weight decay) more clearly.",
                "Provide detailed steps on deployment, especially containerization (Docker) and monitoring tools (Prometheus/Grafana).",
                "Elaborate on custom loss functions or specific validation splitting strategies (e.g. Stratified K-Fold)."
            ],
            "Backend Dev": [
                "Explain the exact write-path and read-path for distributed cache invalidation strategies (Write-Through vs Cache-Aside).",
                "Elaborate on data consistency trade-offs (CAP theorem) when discussing distributed microservice designs.",
                "Provide specific API security practices like CORS configurations, CSRF protection, and SQL injection prevention."
            ],
            "Behavioral": [
                "Structure answers strictly around the STAR method: explicitly state the Situation, Task, Action, and Result.",
                "Focus more on the collaborative 'we' while maintaining absolute clarity on your individual 'I' contributions.",
                "Explain lessons learned and tangible metrics of success rather than just the final project resolution."
            ]
        }

        return {
            "clarity": clarity,
            "technical_depth": tech,
            "confidence": conf,
            "summary": (
                f"The candidate demonstrated a solid foundational understanding of {self.interview_type} concepts. "
                "Responses were structured but could benefit from deeper technical detail, practical code design patterns, "
                "and explicit examples from past production projects. Communication style was clear and constructive overall."
            ),
            "suggestions": suggestions.get(self.interview_type, suggestions["React Developer"])
        }

def transcribe_audio(audio_data: bytes) -> str:
    """
    Transcribes binary audio data using Whisper API.
    If no OpenAI client is configured, returns an empty string (caller will handle fallback).
    """
    if not client:
        return ""
    
    try:
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as temp_audio:
            temp_audio.write(audio_data)
            temp_audio_path = temp_audio.name

        try:
            with open(temp_audio_path, "rb") as audio_file:
                transcript = client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file
                )
            return transcript.text
        finally:
            os.remove(temp_audio_path)
    except Exception as e:
        print(f"Error transcribing audio in Whisper: {e}")
        return ""

def text_to_speech(text: str) -> str:
    """
    Converts text to speech using OpenAI TTS API and returns base64 encoded audio string.
    If no OpenAI client is configured, returns an empty string.
    """
    if not client:
        return ""
        
    try:
        response = client.audio.speech.create(
            model="tts-1",
            voice="alloy",
            input=text
        )
        audio_bytes = response.read()
        audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
        return audio_base64
    except Exception as e:
        print(f"Error in TTS conversion: {e}")
        return ""
