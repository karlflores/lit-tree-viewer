import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Toggle from '../components/Toggle'

describe('Toggle', () => {
  it('renders the label text', () => {
    render(<Toggle checked={false} onChange={() => {}} label="Show labels" />)
    expect(screen.getByText('Show labels')).toBeInTheDocument()
  })

  it('renders a switch button', () => {
    render(<Toggle checked={false} onChange={() => {}} label="Toggle" />)
    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('reflects checked=false in aria-checked', () => {
    render(<Toggle checked={false} onChange={() => {}} label="Toggle" />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  it('reflects checked=true in aria-checked', () => {
    render(<Toggle checked={true} onChange={() => {}} label="Toggle" />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('calls onChange with inverted value when clicked (false → true)', async () => {
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange} label="Toggle" />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('calls onChange with inverted value when clicked (true → false)', async () => {
    const onChange = vi.fn()
    render(<Toggle checked={true} onChange={onChange} label="Toggle" />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('calls onChange exactly once per click', async () => {
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange} label="Toggle" />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
