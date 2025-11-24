/**
 * Weather Tool
 *
 * Get current weather for a city (simulated)
 */

import { getLogger } from '@looopy-ai/core';
import { tool } from '@looopy-ai/core/ts';
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

export const weatherTool = tool({
  name: 'get_weather',
  icon: 'lucide:cloud-sun',
  description: 'Get current weather for a city (simulated)',
  schema: z.object({
    city: z.string().describe('City name'),
    location: z.string().optional().describe('Alternative location parameter'),
    units: z
      .enum(['celsius', 'fahrenheit'])
      .optional()
      .describe('Temperature units (default: celsius)'),
  }),
  handler: async ({ city, location, units }) => {
    const logger = getLogger({ component: 'weather-tool', city, location, units });
    const cityName = (city || location || 'San Francisco').toLowerCase();

    logger.info({ city: cityName, units }, `🔧 [LOCAL] Executing: get_weather`);

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

    logger.info({ weather: weatherResult }, 'Success');

    return weatherResult;
  },
});
