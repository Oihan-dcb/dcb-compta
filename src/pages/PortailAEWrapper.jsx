import { useParams } from 'react-router-dom'
import PortailAE from './PortailAE'

export default function PortailAEWrapper() {
  const { token } = useParams()
  return <PortailAE token={token} />
}