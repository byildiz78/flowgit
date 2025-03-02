import { NextRequest, NextResponse } from 'next/server';
import { format } from 'date-fns';

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const fromDate = searchParams.get('from') || format(new Date(), 'yyyy-MM-dd');
    const toDate = searchParams.get('to') || format(new Date(), 'yyyy-MM-dd');
    const statusFilter = searchParams.get('status') || '';  // Optional status filter
    const start = Number(searchParams.get('start') || '0');
    const limit = Number(searchParams.get('limit') || '50');
    const fetchAll = searchParams.get('fetchAll') === 'true';

    // Format dates for API request
    const fromDateTime = `${fromDate}T00:00:00+03:00`;
    const toDateTime = `${toDate}T23:59:59+03:00`;

    // Get Flow API URL from environment variables
    const flowUrl = process.env.FLOW_URL;
    
    if (!flowUrl) {
      return NextResponse.json({ error: 'Flow API URL is not configured' }, { status: 500 });
    }

    // Extract the base URL and endpoint from FLOW_URL
    // FLOW_URL looks like https://crm.robotpos.com/rest/1/q5w7kffwsbyyct5i/crm.item.add
    // We need https://crm.robotpos.com/rest/1/q5w7kffwsbyyct5i/crm.item.list
    const baseUrlWithToken = flowUrl.substring(0, flowUrl.lastIndexOf('/'));
    const listEndpoint = `${baseUrlWithToken}/crm.item.list`;

    // Prepare filter object
    const filter: any = {
      '>=createdTime': fromDateTime,
      '<=createdTime': toDateTime
    };
    
    // Add status filter if provided
    if (statusFilter) {
      if (statusFilter === "DT1036_10:SUCCESS") {
        // For SUCCESS, also include DT1036_32:SUCCESS
        filter.stageId = [statusFilter, "DT1036_32:SUCCESS"];
      } else {
        filter.stageId = statusFilter;
      }
    }

    if (fetchAll) {
      // Fetch all items with pagination
      let allItems: any[] = [];
      let currentStart = 0;
      let totalRecords = 0;
      let hasMore = true;

      // Continue fetching until we have all items
      while (hasMore) {
        // Make the request to Flow API with pagination
        const response = await fetch(listEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            entityTypeId: 1036,
            filter: filter,
            start: currentStart,
            limit: 50 // Standard page size
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Flow API error:', errorText);
          return NextResponse.json({ error: 'Error fetching data from Flow API' }, { status: response.status });
        }

        const data = await response.json();
        
        // Set the total from the first response
        if (totalRecords === 0) {
          totalRecords = data.total || 0;
        }
        
        // Add the current batch of items to our collection
        if (data.result && data.result.items) {
          allItems = [...allItems, ...data.result.items];
          
          // Check if there are more items to fetch
          if (data.next && allItems.length < totalRecords) {
            // Update start position for next request
            currentStart = data.next;
          } else {
            // We've got all items, exit the loop
            hasMore = false;
          }
        } else {
          // No items or unexpected response format
          hasMore = false;
        }
      }

      // Return all items
      return NextResponse.json({
        result: {
          items: allItems,
        },
        total: totalRecords
      });
    } else {
      // Just fetch the requested page
      const response = await fetch(listEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entityTypeId: 1036,
          filter: filter,
          start: start,
          limit: limit
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Flow API error:', errorText);
        return NextResponse.json({ error: 'Error fetching data from Flow API' }, { status: response.status });
      }

      // Parse the raw JSON response
      const apiResponse = await response.json();
      
      // Extract the items and total from the response
      const items = apiResponse.result?.items || [];
      const total = apiResponse.total || 0;
      const next = apiResponse.next || null;
      
      // Return the response with correct structure
      return NextResponse.json({
        result: {
          items: items,
        },
        total: total,
        next: next
      });
    }
  } catch (error) {
    console.error('Error in flow analysis API:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
