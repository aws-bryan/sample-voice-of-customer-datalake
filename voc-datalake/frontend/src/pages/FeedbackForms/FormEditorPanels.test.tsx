import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithQueryClient as render } from '../../test/query-client'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { CategoryPanel } from './FormEditorPanels'
import type { EditorCategory } from './FormEditorPanels'
import { defaultFormConfig } from './formTemplates'

type Props = ComponentProps<typeof CategoryPanel>

const CATEGORIES: EditorCategory[] = [
  {
    id: 'cat_1',
    name: 'ease_of_use',
    description: 'Ease of use',
    subcategories: [{ id: 'sub_1', name: 'onboarding_flow' }],
  },
  { id: 'cat_2', name: 'api_automation', subcategories: [] },
]

function renderPanel(formData: Partial<Props['formData']>, onChange: Props['onChange'] = vi.fn()) {
  const draft = { ...defaultFormConfig, category: '', subcategory: '', ...formData }
  return render(<CategoryPanel formData={draft} onChange={onChange} fieldId="f" categories={CATEGORIES} />)
}

describe('CategoryPanel routing options', () => {
  it('labels each category (configured name, else humanised id) while the option value stays the id', () => {
    renderPanel({})

    expect(screen.getByRole('option', { name: 'Ease of use' })).toHaveValue('cat_1')
    expect(screen.getByRole('option', { name: 'API automation' })).toHaveValue('cat_2')
  })

  it('labels subcategories and sends the id when one is picked', async () => {
    const onChange = vi.fn()
    renderPanel({ category: 'cat_1' }, onChange)

    await userEvent.setup().selectOptions(screen.getByLabelText(/subcategory/i), 'Onboarding flow')
    expect(onChange).toHaveBeenCalledWith({ subcategory: 'sub_1' })
  })
})
