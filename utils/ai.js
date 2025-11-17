import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const summarizeProposal = async (proposal) => {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
  });

  const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
    responseMimeType: "text/plain",
  };

  const chatSession = model.startChat({
    generationConfig,
    history: [
      {
        role: "user",
        parts: [
          {
            text: `You summarize a proposal.`,
          },
        ],
      },
    ],
  });

  const prompt = `Summarize the following proposal: ${proposal}`;

  const result = await chatSession.sendMessage(prompt);

  const summary = result.response.text();

  if (!summary) {
    throw new Error("Failed to summarize proposal");
  }

  return summary;
};

const SYSTEM_PROMPT = `
You are a helpful assistant that can help with the following tasks:
- Takes in Dao Id, Proposal Details, Decision Criteria, Response format
- Returns the output in a json format, and nothing else
- Provides the rationale for the vote in the response as per given Operating Values
- Write as if you are writing in behalf of the company
- **Convert the vote into an integer based on the provided choices (starting from 1)**
- Don't include names in the response
- **Do not include any additional text or formatting**
- Keep it concise, maximum 3 lines
- Don't use DAOplomats name, just provide pure reason (example:For, Supporting this proposal guarantees consistent, transparent reporting on 1inch’s key metrics, empowering stakeholders with data-driven insights, attracting ecosystem participants, and enhancing growth through independent, high-quality research and analysis. )
- Don't use the given example to generate the response
- Use B2 level English
- Randomize between 10, 30 and 50 word rationales
- Write specially why a given vote was chosen incase of proposals with more than 3 options
`;

const decideProposal = async (daoId, title, description, choices) => {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: SYSTEM_PROMPT,
  });

  const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
    responseMimeType: "text/plain",
  };

  const knBase = fs.readFileSync(
    `${process.env.PROJECT_ROOT}/knBase/${daoId}/knowledge_sum.txt`,
    "utf-8"
  );

  const opValues = fs.readFileSync(
    `${process.env.PROJECT_ROOT}/knBase/${daoId}/op_values.txt`,
    "utf-8"
  );

  const chatSession = model.startChat({
    generationConfig,
    history: [
      {
        role: "user",
        parts: [
          {
            text: `The following data is the past ${daoId} DAO proposals: ${knBase}`,
          },
        ],
      },
      {
        role: "user",
        parts: [
          {
            text: `Here is the operating values: ${opValues}`,
          },
        ],
      },
    ],
  });

  const message = `
    - Dao Id : ${daoId}

    - Proposal Details : 
        title : ${title}
        Summary : ${description}
        Voting Choices : ${choices}
        Voting Type : Single Choice Voting
    
    - Decision Criteria : 
      1. Your vote must align **strictly** with the given character profile.
      2. Consider the **sentiment, personality traits, and interests** of the character when making a decision.
      3. Provide a well-reasoned justification for your vote based on the character's profile.
      4. Do not introduce personal bias—your decision should be objective and profile-driven.
      
      - Response Format : 
      {
        "vote": "<index of the chosen option (starting from 1)>",
        "reason": "<Your reason for this vote>"
      }
  `;

  const result = await chatSession.sendMessage(message);

  const parsedResponse = parseVoteResponse(result.response.text());

  return {
    vote: parsedResponse.vote,
    reason: parsedResponse.reason,
  };
};

function parseVoteResponse(response) {
  try {
    const jsonMatch = response.match(/{[\s\S]*}/);

    if (!jsonMatch) {
      throw new Error("No valid JSON found in the response");
    }

    const parsedData = JSON.parse(jsonMatch[0]);

    return {
      vote: parsedData.vote,

      reason: parsedData[Object.keys(parsedData)[1]],
    };
  } catch (error) {
    return {
      vote: null,
      reason: null,
    };
  }
}

export { summarizeProposal, decideProposal };
