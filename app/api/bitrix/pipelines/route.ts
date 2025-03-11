import { NextResponse } from 'next/server';
import pool from '@/../../lib/db';

const BASE_URL = "https://crm.robotpos.com/rest/1/q5w7kffwsbyyct5i";

// Helper function to make API requests
async function makeRequest(url: string, payload: any) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API request error:', error);
    throw error;
  }
}

export async function GET() {
  // Check if the database connection pool is available
  if (!pool) {
    return NextResponse.json(
      { error: 'Database connection failed' },
      { status: 500 }
    );
  }

  try {
    // 1. Get pipelines exactly as in the curl command
    const pipelineUrl = `${BASE_URL}/crm.category.list`;
    const pipelinePayload = { entityTypeId: 1036 };
    
    console.log('Fetching pipelines with payload:', JSON.stringify(pipelinePayload));
    const pipelineResponse = await makeRequest(pipelineUrl, pipelinePayload);
    console.log('Pipeline response:', JSON.stringify(pipelineResponse).substring(0, 200) + '...');
    
    const pipelines = pipelineResponse.result?.categories || [];
    
    if (!pipelines || pipelines.length === 0) {
      console.error('No pipelines returned from API');
      return NextResponse.json(
        { error: 'No pipelines found' },
        { status: 404 }
      );
    }
    
    // 2. Create pipeline map and collect all stages
    const pipelineMap: Record<number, string> = {};
    let allStages: any[] = [];
    
    // Add pipelines to the map
    pipelines.forEach((pipeline: any) => {
      pipelineMap[pipeline.id] = pipeline.name;
    });
    
    // 3. Get stages for each pipeline exactly as in the curl command
    for (const pipeline of pipelines) {
      const pipelineId = pipeline.id;
      const pipelineName = pipeline.name;
      
      const stagesUrl = `${BASE_URL}/crm.status.list`;
      const stagesPayload = {
        filter: {
          ENTITY_ID: `DYNAMIC_1036_STAGE_${pipelineId}`
        }
      };
      
      console.log(`Fetching stages for pipeline ${pipelineId} with payload:`, JSON.stringify(stagesPayload));
      const stagesResponse = await makeRequest(stagesUrl, stagesPayload);
      console.log(`Stages response for pipeline ${pipelineId}:`, JSON.stringify(stagesResponse).substring(0, 200) + '...');
      
      const stages = stagesResponse.result || [];
      
      // Add pipeline information to each stage
      const stagesWithPipeline = stages.map((stage: any) => ({
        ...stage,
        pipelineId,
        pipelineName
      }));
      
      allStages = [...allStages, ...stagesWithPipeline];
    }
    
    // 4. Format and return the data
    const formattedData = {
      pipelines: pipelines.map((pipeline: any) => ({
        id: pipeline.id,
        name: pipeline.name,
        sort: pipeline.sort,
        isDefault: pipeline.isDefault === 'Y'
      })),
      stages: allStages.map((stage: any) => ({
        id: stage.ID,
        statusId: stage.STATUS_ID,
        name: stage.NAME,
        entityId: stage.ENTITY_ID,
        color: stage.COLOR || stage.EXTRA?.COLOR || "#808080",
        pipelineId: stage.pipelineId,
        pipelineName: stage.pipelineName
      })),
      pipelineMap,
      debug: {
        pipelineCount: pipelines.length,
        stageCount: allStages.length,
        samplePipeline: pipelines.length > 0 ? pipelines[0] : null,
        sampleStage: allStages.length > 0 ? allStages[0] : null
      }
    };
    
    return NextResponse.json(formattedData);
  } catch (error) {
    console.error('Error fetching pipeline data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline data', details: (error as Error).message },
      { status: 500 }
    );
  }
}
