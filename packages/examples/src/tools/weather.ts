/**
 * Weather Tool
 *
 * Get current weather for a city (simulated)
 */

import { tool } from '@looopy-ai/core/ts/tools';
import { z } from 'zod';

// Simulated weather data
const weatherData: Record<string, { temp: number; condition: string }> = {
  'san francisco': { temp: 68, condition: 'sunny' },
  'new york': { temp: 52, condition: 'cloudy' },
  seattle: { temp: 55, condition: 'rainy' },
  miami: { temp: 82, condition: 'sunny' },
  chicago: { temp: 45, condition: 'windy' },
  paris: { temp: 15, condition: 'cloudy' },
  london: { temp: 12, condition: 'rainy' },
};

export const weatherTool = tool(
  'get_weather',
  'Get current weather for a city (simulated)',
  z.object({
    city: z.string().describe('City name'),
    location: z.string().optional().describe('Alternative location parameter'),
    units: z
      .enum(['celsius', 'fahrenheit'])
      .optional()
      .describe('Temperature units (default: celsius)'),
  }),
  async ({ city, location, units }) => {
    const cityName = (city || location || 'San Francisco').toLowerCase();

    console.log(`\n🔧 [LOCAL] Executing: get_weather`);
    console.log(`   Arguments:`, { city: cityName, units });

    // Simulate weather API call
    await new Promise((resolve) => setTimeout(resolve, 500));

    const weather = weatherData[cityName] || weatherData['san francisco'];

    const weatherResult = {
      city: cityName,
      location: cityName,
      temperature: weather.temp,
      units: units || 'fahrenheit',
      condition: weather.condition,
      humidity: Math.floor(Math.random() * 40) + 40,
      timestamp: new Date().toISOString(),
    };

    console.log(`   ✓ Weather:`, weatherResult);

    return weatherResult;
  },
);
