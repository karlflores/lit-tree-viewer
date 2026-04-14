import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CharacterPanel from '../components/CharacterPanel'
import type { Character, Series, Relationship } from '../types/domain'

const series: Series = {
  id: 's1',
  title: 'The Count of Monte Cristo',
  mediaType: 'book',
  unitLabel: 'Chapter',
  totalUnits: 117,
}

const edmond: Character = {
  id: 'c1',
  seriesId: 's1',
  name: 'Edmond Dantès',
  aliases: ['The Count of Monte Cristo', 'Sinbad'],
  description: 'The protagonist of the story.',
  imageUrl: null,
  introducedAt: 1,
  diedAt: null,
}

const mercedes: Character = {
  id: 'c2',
  seriesId: 's1',
  name: 'Mercédès',
  aliases: [],
  description: null,
  imageUrl: null,
  introducedAt: 1,
  diedAt: null,
}

const relationship: Relationship = {
  id: 'r1',
  seriesId: 's1',
  fromId: 'c1',
  toId: 'c2',
  kind: 'romantic',
  label: 'Fiancée',
  directed: false,
  introducedAt: 1,
  endedAt: null,
}

const defaultProps = {
  character: edmond,
  relationships: [] as Relationship[],
  allCharacters: [edmond, mercedes],
  series,
  atUnit: 10,
  isOpen: true,
  onClose: vi.fn(),
}

describe('CharacterPanel', () => {
  it('renders the character name', () => {
    render(<CharacterPanel {...defaultProps} />)
    expect(screen.getByText('Edmond Dantès')).toBeInTheDocument()
  })

  it('renders aliases when present', () => {
    render(<CharacterPanel {...defaultProps} />)
    expect(screen.getByText('The Count of Monte Cristo · Sinbad')).toBeInTheDocument()
  })

  it('renders the character description', () => {
    render(<CharacterPanel {...defaultProps} />)
    expect(screen.getByText('The protagonist of the story.')).toBeInTheDocument()
  })

  it('renders "First appears" with the correct unit', () => {
    render(<CharacterPanel {...defaultProps} />)
    expect(screen.getByText('First appears: Chapter 1')).toBeInTheDocument()
  })

  it('shows a deceased indicator when the character has died by atUnit', () => {
    const deceased: Character = { ...edmond, diedAt: 5 }
    render(<CharacterPanel {...defaultProps} character={deceased} atUnit={10} />)
    expect(screen.getByText(/† Chapter 5/)).toBeInTheDocument()
  })

  it('does not show a deceased indicator for a living character', () => {
    render(<CharacterPanel {...defaultProps} />)
    expect(screen.queryByText(/†/)).not.toBeInTheDocument()
  })

  it('renders the close button', () => {
    render(<CharacterPanel {...defaultProps} />)
    expect(screen.getByRole('button', { name: /close panel/i })).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    render(<CharacterPanel {...defaultProps} onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /close panel/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders relationships when present', () => {
    render(<CharacterPanel {...defaultProps} relationships={[relationship]} />)
    expect(screen.getByText('Mercédès')).toBeInTheDocument()
    expect(screen.getByText('Fiancée')).toBeInTheDocument()
  })

  it('shows the undirected arrow symbol for non-directed relationships', () => {
    render(<CharacterPanel {...defaultProps} relationships={[relationship]} />)
    expect(screen.getByText('↔')).toBeInTheDocument()
  })

  it('shows directed arrow → when fromId matches the character', () => {
    const directed: Relationship = { ...relationship, directed: true }
    render(<CharacterPanel {...defaultProps} relationships={[directed]} />)
    expect(screen.getByText('→')).toBeInTheDocument()
  })

  it('shows directed arrow ← when toId matches the character', () => {
    const incoming: Relationship = { ...relationship, fromId: 'c2', toId: 'c1', directed: true }
    render(<CharacterPanel {...defaultProps} relationships={[incoming]} />)
    expect(screen.getByText('←')).toBeInTheDocument()
  })

  it('shows the initials avatar when no imageUrl is set', () => {
    render(<CharacterPanel {...defaultProps} />)
    // Initials of 'Edmond Dantès' → 'ED'
    expect(screen.getByText('ED')).toBeInTheDocument()
  })

  it('applies translate-x-0 when isOpen is true', () => {
    const { container } = render(<CharacterPanel {...defaultProps} isOpen={true} />)
    const aside = container.querySelector('aside')
    expect(aside?.className).toContain('translate-x-0')
  })

  it('applies translate-x-[calc(100%+1rem)] when isOpen is false', () => {
    const { container } = render(<CharacterPanel {...defaultProps} isOpen={false} />)
    const aside = container.querySelector('aside')
    expect(aside?.className).toContain('translate-x-[calc(100%+1rem)]')
  })
})
