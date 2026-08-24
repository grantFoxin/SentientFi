import { useState, useEffect } from 'react'
import { apiRequest, API_CONFIG } from '../config/api'

interface PortfolioData {
    id: string
    totalValue: number
    allocations: Array<{
        asset: string
        target: number
        current: number
        amount: number
    }>
    needsRebalance: boolean
    lastRebalance: string
}

interface PortfolioResponse {
    success?: boolean
    portfolio: PortfolioData
}

export const usePortfolio = (portfolioId?: string) => {
    const [portfolio, setPortfolio] = useState<PortfolioData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!portfolioId) return

        const fetchPortfolio = async () => {
            try {
                setLoading(true)
                const data = await apiRequest<PortfolioResponse>(
                    `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.PORTFOLIO_DETAIL(portfolioId)}`
                )
                if (!data?.portfolio) {
                    throw new Error('Failed to fetch portfolio')
                }
                setPortfolio(data.portfolio)
                setError(null)
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Unknown error')
            } finally {
                setLoading(false)
            }
        }

        fetchPortfolio()

        // Set up polling for real-time updates
        const interval = setInterval(fetchPortfolio, 30000)
        return () => clearInterval(interval)
    }, [portfolioId])

    const executeRebalance = async () => {
        if (!portfolioId) return

        try {
            await apiRequest(
                `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.PORTFOLIO_REBALANCE(portfolioId)}`,
                {
                    method: 'POST',
                    body: JSON.stringify({}),
                }
            )

            // Refresh portfolio data
            const data = await apiRequest<PortfolioResponse>(
                `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.PORTFOLIO_DETAIL(portfolioId)}`
            )
            if (!data?.portfolio) {
                throw new Error('Failed to fetch portfolio')
            }
            setPortfolio(data.portfolio)
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Rebalance failed')
        }
    }

    return { portfolio, loading, error, executeRebalance }
}
