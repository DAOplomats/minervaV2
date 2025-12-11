import OpenAI from "openai";
import fs from "fs";

// Initialize OpenRouter client
const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const summarizeProposal = async (proposal) => {
  try {
    const completion = await openai.chat.completions.create({
      model: "google/gemini-2.0-flash-001",
      messages: [
        {
          role: "system",
          content: "You summarize a proposal.",
        },
        {
          role: "user",
          content: `Summarize the following proposal: ${proposal}`,
        },
      ],
      temperature: 1,
      top_p: 0.95,
      max_tokens: 8192,
    });

    const summary = completion.choices[0].message.content;

    if (!summary) {
      throw new Error("Failed to summarize proposal");
    }

    return summary;
  } catch (error) {
    console.error("Error in summarizeProposal:", error);
    throw error;
  }
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
  try {
    const knBase = fs.readFileSync(
      `${process.env.PROJECT_ROOT}/knBase/${daoId}/knowledge_sum.txt`,
      "utf-8"
    );

    const opValues = fs.readFileSync(
      `${process.env.PROJECT_ROOT}/knBase/${daoId}/op_values.txt`,
      "utf-8"
    );

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

    const completion = await openai.chat.completions.create({
      model: "google/gemini-2.0-flash-001", // Updated to valid OpenRouter ID
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `The following data is the past ${daoId} DAO proposals: ${knBase}`,
        },
        {
          role: "user",
          content: `Here is the operating values: ${opValues}`,
        },
        {
          role: "user",
          content: message,
        },
      ],
      temperature: 1,
      top_p: 0.95,
      max_tokens: 8192,
    });

    const resultText = completion.choices[0].message.content;
    const parsedResponse = parseVoteResponse(resultText);

    return {
      vote: parsedResponse.vote,
      reason: parsedResponse.reason,
    };
  } catch (error) {
    console.error("Error in decideProposal:", error);
    throw error;
  }
};

function parseVoteResponse(response) {
  try {
    // Clean up potential markdown code blocks (OpenRouter models often add ```json ... ```)
    const cleanResponse = response.replace(/```json\n?|```/g, "").trim();

    const jsonMatch = cleanResponse.match(/{[\s\S]*}/);

    if (!jsonMatch) {
      throw new Error("No valid JSON found in the response");
    }

    const parsedData = JSON.parse(jsonMatch[0]);

    // Handle case where keys might be slightly different or cased differently
    const keys = Object.keys(parsedData);
    const voteKey =
      keys.find((k) => k.toLowerCase().includes("vote")) || keys[0];
    const reasonKey =
      keys.find((k) => k.toLowerCase().includes("reason")) || keys[1];

    return {
      vote: parsedData[voteKey],
      reason: parsedData[reasonKey],
    };
  } catch (error) {
    console.warn("JSON Parse Error:", error);
    return {
      vote: null,
      reason: null,
    };
  }
}

export { summarizeProposal, decideProposal };
